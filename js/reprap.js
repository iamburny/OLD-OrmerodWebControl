/*! Reprap Ormerod Web Control | by Matt Burnett <matt@burny.co.uk>. | open license
 */
var ver = 0.80; //App version
var reqFWver = '0.59b-dc42'; //Recommended Duet Firmware
var currFWver;

//Ormerod Status vars
var polling = false;
var webPrinting = false;
var printing = false;
var paused = false;
var messageSeqId = 0;

//Ormerod Settings
var ormerodIP, storage, layerHeight, pollFreq;
var maxUploadBuffer = 1500;
var maxUploadCommands = 50;

//Printing progress vars
var printType;
var layerCount, currentLayer, objHeight; //layer
var objTotalFilament, currentFilamentPos, objUsedFilament, startingFilamentPos = 0; //filament
var timerStart, printStartTime, thisLaterTime; //timing
var startProgress, lastProgress = 0;

//Temp/Layer Chart settings
var chart, chart2;
var maxDataPoints = 200;
var chartData = [[], []];
var maxLayerBars = 200;
var layerData = [];
var bedColour = "#454BFF"; //blue
var headColour = "#FC2D2D"; //red

//gCode file handling vars
var fileTypes = ["g", "gco", "gcode", "htm", "js", "css"];
var tempfilename = "temp.gcode";
var gFile = [];
var gFileLength, gFilename, buffer, charsSent;
var bufferStore = [];
var lineLenStore = [];

//Display configs
var macroGs = ['setbed.g']; //macro g files to add as Quick Buttons
var chevLeft = "<span class='glyphicon glyphicon-chevron-left'></span>";
var chevRight = "<span class='glyphicon glyphicon-chevron-right'></span>";


jQuery.extend({
    askElle: function(reqType, code) {
        var result;
        var query = "";
        switch (reqType) {
            case 'encodedGcode':
                query = "?gcode=" + code;		// 'code' has already been URI encoded
                reqType = "gcode";
                break;
            case 'gcode':
                query = "?gcode=" + encodeURIComponent(code);
                break;
            case 'fileinfo':
                query = "?name=" + encodeURIComponent(code);
                break;
        }
        var url = '//' + ormerodIP + '/rr_' + reqType + query;
        $.ajax(url, {
            async: false,
            dataType: "json",
            success: function(data) {
                result = data;
            }}
        );
        return result;
    }
});

$(document).ready(function() {
    storage = $.localStorage;
    getSettings();
    applySettings();
    moveVals(['X', 'Y', 'Z']);
    homeBtns();

    ormerodIP = location.host;
    $('#hostLocation').text(ormerodIP);

    if ($.support.fileDrop) {
        fileDrop();
    } else {
        modalMessage('Your browser does not support file drag n\' drop',
                'You\'ll have to Click and select a file instead', close);
    }

    //fill temp chart with dummy data
    for (var i = 0; i < maxDataPoints; i++) {
        chartData[0].push([i, 20]);
        chartData[1].push([i, 10]);
    }

    //chart line colours
    $('#bedTxt').css("color", bedColour);
    $('#headTxt').css("color", headColour);

    chart = $.plot("#tempchart", chartData, {
        series: {shadowSize: 0},
        colors: [bedColour, headColour],
        yaxis: {min: -20, max: 250},
        xaxis: {show: false},
        grid: {
            borderWidth: 0
        }
    });

    chart2 = $.plot("#layerChart", [{
            data: layerData,
            bars: {show: true}
        }], {
        series: {shadowSize: 0},
        xaxis: {minTickSize: 1, tickDecimals: 0, panRange: [0, null], zoomRange: [20, 50]},
        yaxis: {minTickSize: 1, min: 0, tickDecimals: 0, panRange: false},
        grid: {borderWidth: 0},
        pan: {interactive: true}
    });

    message('success', 'Interface Initialised, page load complete ready for connect');
    $('button#connect, button#printing').removeClass('disabled');
});

/**
 * HTM, JS and FW version checking
 * 
 */
function checkVersions()
{
    var htmVer = getHTMLver();
    var syncMessage = '';
    var fwMessage = '';

    $('p#htmVer').text(htmVer);
    $('p#jsVer').text(ver);
    if (htmVer != ver) {
        syncMessage = "The reprap.htm on your Duet is v" + getHTMLver() +
                "<br />The reprap.js currently in use is v" + ver +
                "<br />To ensure compatibility please use the same versions of these files. <br /><br />";
    }
    if (currFWver != reqFWver) {
        fwMessage = "The frimware on your Duet is " + currFWver +
                "<br />The recommended version for this interface is " + reqFWver;
    }

    if (syncMessage != '' || fwMessage != '') {
        //pop message
        modalMessage("Warning!, version check failed", syncMessage + fwMessage, true);
    }
}

/**
 *Start/Stop Polling Loop
 */
$('#connect').on('click', function() {
    if (polling) {
        polling = false;
        updatePage();
    } else {
        polling = true;
        updatePage();
        listGFiles();
        $.askElle("gcode", "M115"); //get firmware
        poll();
    }
});

//Bed Temp controls
$('#bedTemperature').on('click', '#setBedTemp', function() {
    $.askElle('gcode', "M140 S" + $('#bedTempInput').val());
}).on('click', '#bedTempLink', function() {
    $('#bedTempInput').val($(this).text());
    $.askElle('gcode', "M140 S" + $(this).text());
}).on('keydown', '#bedTempInput', function(event) {
    if (event.which === 13) //Press Enter/Return Key
    {
        event.preventDefault();
        $.askElle('gcode', "M140 S" + $(this).val());
    }
}).on('click', '#addBedTemp', function() {
    var tempVal = $('#bedTempInput').val();
    if (tempVal != "") {
        var temps = storage.get('temps', 'bed');
        temps.unshift(parseInt(tempVal));
        storage.set('temps.bed', temps);
        applySettings();
    } else {
        modalMessage("Error Adding Bed Temp!", "You must enter a Temperature to add it to the dropdown list", close);
    }
});

//Head Temp controls
$('#headTemperature').on('click', '#setHeadTemp', function() {
    $.askElle('gcode', "G10 P0 S" + $('input#headTempInput').val() + "\nT0");
}).on('click', '#headTempLink', function() {
    $('#headTempInput').val($(this).text());
    $.askElle('gcode', "G10 P0 S" + $(this).text() + "\nT0");
}).on('keydown', '#headTempInput', function(event) {
    if (event.which === 13)  //Press Enter/Return Key
    {
        event.preventDefault();
        $.askElle('gcode', "G10 P0 S" + $(this).val() + "\nT0");
    }
}).on('click', '#addHeadTemp', function() {
    var tempVal = $('#headTempInput').val();
    if (tempVal != "") {
        var temps = storage.get('temps', 'head');
        temps.unshift(parseInt(tempVal));
        storage.set('temps.head', temps);
        applySettings();
    } else {
        modalMessage("Error Adding Head Temp!", "You must enter a Temperature to add it to the dropdown list", close);
    }
});

//feed controls
$('div#feed').on('click', 'button#feed', function() {
    var amount = $(this).val();
    var dir = "";
    if ($('input[name="feeddir"]:checked').attr('id') == "reverse") {
        dir = "-";
    }
    var feedRate = " F" + $('input[name="speed"]:checked').val();
    var code = "M120\nM83\nG1 E" + dir + amount + feedRate + "\nM121";
    $.askElle('gcode', code);
});

//gcodes buttons
$('div#sendG button#txtinput, div#sendG a').on('click', function() {
    var code;
    if (this.nodeName === 'BUTTON') {
        code = $('input#gInput').val().toUpperCase();
    } else {
        code = $(this).text();
    }
    $.askElle('gcode', code); //send gcode
});
$('div#quicks').on('click', 'a', function() {
    var code;
    if (this.attributes.itemprop) {
        code = this.attributes.itemprop.value;
    } else {
        code = $(this).text();
    }
    $.askElle('gcode', code);
});
$('input#gInput').keydown(function(event) {
    if (event.which === 13) {
        event.preventDefault();
        $.askElle('gcode', $(this).val().toUpperCase());
    }
});

//move controls
$('table#moveHead').on('click', 'button', function() {
    var btnVal = $(this).attr('value');
    if (btnVal) {
        $.askElle('gcode', btnVal);
    } else {
        var value = $(this).text();

        var feedRate = " F2000";
        if (value.indexOf("Z") >= 0)
            feedRate = " F200";

        var movePreCode = "M120\nG91\nG1 ";
        var movePostCode = "\nM121";
        $.askElle('gcode', movePreCode + value + feedRate + movePostCode);
    }
});

//panic button actions
$('div#panicBtn button').on('click', function() {
    var btnVal = $(this).attr('value');
    switch (btnVal) {
        case "M112":
            //panic stop
            window.stop();
            webPrinting = false;
            paused = false;
            break;
        case "reset":
            //reset printing after pause
            gFile = [];
            gFileIndex = 0;
            printing = false;
            paused = false;
            btnVal = "M1";
            //switch off heaters
            $.askElle('gcode', "M140 S0"); //bed off
            $.askElle('gcode', "G10 P0 S0\nT0"); //head 0 off
            resetLayerData("");
        case "M24":
            //resume
            paused = false;
            $('button#pause').removeClass('active').text('Pause').attr('value', 'M25');
            $('button#printing').text("Ready :)");
            $('button#reset').addClass('hidden');
            break;
        case "M25":
            //pause
            paused = true;
            $(this).addClass('active').text('Resume').attr('value', 'M24');
            $('button#printing').text("Paused");
            $('button#reset').removeClass('hidden');
            break;
    }
    $.askElle('gcode', btnVal);
});

//g files
$("div#gFileList, div#gFileList2, div#gFileList3").on('click', 'button#gFileLink', function() {
    var danger = this.className.indexOf("btn-danger");
    if (danger < 0) {
        printSDfile($(this).text());
    }
}).on('mouseover', 'span#fileDelete', function() {
    $(this).parent().addClass('btn-danger');
}).on('mouseout', 'span#fileDelete', function() {
    $(this).parent().removeClass('btn-danger');
}).on('click', 'span#fileDelete', function() {
    var filename = $(this).parent().text();
    $.askElle('gcode', "M30 " + filename);
    message('success', "G files [" + filename + "] Deleted from the SD card");
    listGFiles();
});
$("button#filereload").on('click', function() {
    $('span#ulTitle').text("File Upload Status");
    setProgress(0, "ul", 0, 0);
    listGFiles();
});
$('#printGfile').on('click', function() {
    $('input#printGselect').click();
});
$('#uploadFile').on('click', function() {
    $('input#uploadSelect').click();
});
$("input#uploadSelect:file").change(function(e) {
    var file = this.files[0];
    readFile(this.files[0], function(e) {
        handleFileDrop(e.target.result, file.name);
    });
    $(this).val('');
});

/**
 * Upload g file choice
 */
$("div#modal").on('click', 'button#uToSD', function() {
    gUploadChoice('upload');
}).on('click', 'button#dPrint', function() {
    gUploadChoice('print');
}).on('click', 'button#uNprint', function() {
    gUploadChoice('uploadandprint');
});

//Settings Save/Delete buttons
$("div#settings").on('click', '#saveSettings', function() {
    saveSettings();
}).on('click', '#delSettings', function() {
    delSettings();
});

//On show tab
$('a[data-toggle="tab"]').on('show.bs.tab', function(e) {
    if (e.target.hash == "#settings") {
        $.askElle("gcode", "M503"); //get config.g on setting view
    }
});

//clear messgae log tab 
$("div#messages button#clearLog").on('click', function() {
    message('clear', '');
});

/**
 * get stored settings, else use these defaults
 * 
 */
function getSettings() {
    if (!storage.get('settings')) {
        storage.set('settings', {pollDelay: 1000, layerHeight: 0.24, halfz: 0, noOK: 0});
    }
    if (!storage.get('temps')) {
        storage.set('temps', {'bed': [120, 65, 0], 'head': [240, 185, 0]});
    }
}

function applySettings() {
    pollFreq = storage.get('settings', 'pollDelay');
    layerHeight = storage.get('settings', 'layerHeight');
    $('div#settings input#pollDelay').val(pollFreq.toString());
    $('div#settings input#layerHeight').val(layerHeight.toString());
    storage.get('settings', 'halfz') == 1 ? $('div#settings input#halfz').prop('checked', true) : $('div#settings input#halfz').prop('checked', false);
    storage.get('settings', 'noOK') == 1 ? $('div#messages input#noOK').prop('checked', true) : $('div#messages input#noOK').prop('checked', false);
    storage.get('settings', 'verwarn') == 1 ? $('div#settings input#verwarn').prop('checked', true) : $('div#settings input#verwarn').prop('checked', false);
    storage.get('settings', 'althome') == 1 ? $('div#settings input#althome').prop('checked', true) : $('div#settings input#althome').prop('checked', false);

    $('div#bedTemperature ul').html('<li class="divider"></li><li><a href="#" id="addBedTemp">Add Temp</a></li>');
    $('div#headTemperature ul').html('<li class="divider"></li><li><a href="#" id="addHeadTemp">Add Temp</a></li>');
    storage.get('temps', 'bed').forEach(function(item) {
        $('div#bedTemperature ul').prepend('<li><a href="#" id="bedTempLink">' + item + '</a></li>');
    });
    storage.get('temps', 'head').forEach(function(item) {
        $('div#headTemperature ul').prepend('<li><a href="#" id="headTempLink">' + item + '</a></li>');
    });
}

function delSettings() {
    storage.removeAll();
    getSettings();
    applySettings();
}

function saveSettings() {
    var zwas = storage.get('settings', 'halfz');
    storage.set('settings.pollDelay', parseInt($('div#settings input#pollDelay').val()));
    storage.set('settings.layerHeight', parseFloat($('div#settings input#layerHeight').val()));
    $('div#settings input#halfz').is(':checked') ? storage.set('settings.halfz', '1') : storage.set('settings.halfz', '0');
    $('div#settings input#noOK').is(':checked') ? storage.set('settings.noOK', '1') : storage.set('settings.noOK', '0');
    $('div#settings input#verwarn').is(':checked') ? storage.set('settings.verwarn', '1') : storage.set('settings.verwarn', '0');
    $('div#settings input#althome').is(':checked') ? storage.set('settings.althome', '1') : storage.set('settings.althome', '0');
    if (zwas !== storage.get('settings', 'halfz')) {
        $('div#Zminus, div#Zplus').text('');
        moveVals(['Z']);
    }
}

/**
 * Create the Head Move buttons
 * 
 * @param {array} axis
 * @returns {undefined}
 */
function moveVals(axis) {
    axis.forEach(function(value) {
        storage.get('settings', 'halfz') == 1 && value == 'Z' ? i = 50 : i = 100;
        var button = 0;
        for (i; i >= 0.05; i = i / 10) {
            $('div#' + value + 'minus').append('<button type="button" class="btn btn-default disabled">' + chevLeft + value + '-' + i.toString() + '</button>');
            $('div#' + value + 'plus').prepend('<button type="button" class="btn btn-default disabled">' + value + '+' + i.toString() + chevRight + '</button>');
            button++;
        }
    });
}

/**
 * Set homing buttons commands to G28 or G92 
 * 
 */
function homeBtns() {
    var gcode;
    var setting = storage.get('settings', 'althome');
    switch (setting)
    {
        case '1':
            gcode = 'G92';
            $('#moveHead button#homeAll').val('G92 X0 Y0 Z0');
            break;
        default:
            gcode = 'G28';
            $('#moveHead button#homeAll').val('G28');
            break;
    }
    $('#moveHead button#homeX').val(gcode + ' X0');
    $('#moveHead button#homeY').val(gcode + ' Y0');
    $('#moveHead button#homeZ').val(gcode + ' Z0');
}


function fileDrop() {
    $('html').fileDrop({
        onFileRead: function(file) {
            handleFileDrop(file[0].data, file[0].name);
        },
        decodeBase64: true,
        removeDataUriScheme: true
    });
}

/**
 * Receive file data and file name from fileDrop function
 * 
 * @param {string} data - file data
 * @param {string} fname - filename
 * @returns {Boolean}
 */
function handleFileDrop(data, fname)
{
    var ext = getFileExt(fname).toLowerCase();
    if (jQuery.inArray(ext, fileTypes) >=0) {
        gFile = data.split(/\r\n|\r|\n/g);
        gFileIndex = 0;
        gFileLength = gFile.length;
        gFilename = fname;
        switch (fname) {
            case "config.g":
                //skip choice just upload, with special code for config file
                uploadFile(fname, 'M559 P', "Config");
                break;
            case "reprap.htm":
            case "reprap.js":
            case "main.css":
                //skip choice just upload, with special code for htm,js,css file
                uploadFile(fname, 'M560 ', "HTM");
                break;
            default:
                //what do you want to do with this G file?
                //Upload to SD, Direct Print, Upload to Temp and Print
                modalMessage('Upload choice for ' + fname, "<div class='text-center'><span id='ulTitle'>What would you like to do?</span><br />" +
                        "<div class='btn-group-vertical'>" +
                        "<button type='button' id='uToSD' class='btn btn-default'>Upload to SD</button>" +
                        "<button type='button' id='dPrint' class='btn btn-default'>Direct Print</button>" +
                        "<button type='button' id='uNprint' class='btn btn-default'>Upload temp\'n print</button>" +
                        "</div></div>", true);
                break;
        }
    } else {
        //alert('Not a G Code file');
        modalMessage("File Error!", 'Not a valid file to print or upload', true);
        return false;
    }
}

/**
 * Choice from file upload modal popup
 * 
 * @param {type} action
 * @returns {undefined}
 */
function gUploadChoice(action) {
    switch (action) {
        case "upload":
            //plain upload to SD
            uploadFile(gFilename, 'M28 ', 'G');
            $('#tabs a:eq(2)').tab('show'); //show Gcode Files tab after drop 
            break;
        case "print":
            printType = "directprint"
            $('div#modal').modal('hide');
            message("info", "Web Printing " + gFilename + " started");
            $('span#gFileDisplay').html('<strong>Direct Web printing ' + gFilename + '</strong>');
            webPrinting = true;
            resetLayerData();
            findHeights();
            $('#tabs a:eq(1)').tab('show'); //show print status tab after drop 
            uploadLoop(action);
            break;
        case "uploadandprint":
            printType = "uploadandprint"; //print when finished upload
            resetLayerData()
            findHeights();
            uploadFile(gFilename, 'M28 ', 'G');
            break;
    }
}

/**
 * Initialise File Upload to the ormerod
 * 
 * @param {string} filename - filename of file to upload
 * @param {string} g - gcode to use to upload (default: M28)
 * @param {string} type - type of file (default: G) 
 */
function uploadFile(filename, g, type)
{
    charsSent = 0;
    if (printType == 'uploadandprint') {
        $.askElle('gcode', g + tempfilename);
        uploadModal();
        $('span#ulTitle').text("Uploading " + filename + " to -> " + tempfilename);
    } else {
        $.askElle('gcode', g + filename);
        uploadModal();
        $('span#ulTitle').text("Uploading " + filename);
    }
    message("info", type + " File, " + filename + ", Upload started");
    timer(); //start upload timer
    uploadLoop("upload");
}

function updateBuffer(resp)
{
    if (typeof resp != 'undefined') {
        buffer = resp.buff;
    } else {
        buffer = 0;
    }
}

/**
 * Loop & webSend until gFile array is empty
 * 
 * @param {string} action
 * @returns {undefined}
 */
function uploadLoop(action) {
    var loop = true;
    var wait = 5; //loop pause
    var linesLeft = gFile.length;

    switch (true) {
        case webPrinting == false && action === 'print':
            //Break Loop stop sending
            gFile = [];
            loop = false;
            break;
        case linesLeft < 1:
            //Finished with file, stop loop, do end tasks
            uploadFinished(action);
            loop = false;
            break;
        case paused == true:
            wait = 2000;
        case buffer == null || buffer < 100:
            updateBuffer($.askElle('status', ''));
            break;
        default:
            for (var i = 0; i < 5; i++) {
                if (buffer > 200) {
                    //send chunk of gcodes or html, and get buffer response
                    updateBuffer($.askElle('encodedGcode', prepareLineToSend()));
                }
            }
    }

    if (loop) {
        if (!webPrinting) {
            uploadStats();
            setProgress(Math.ceil((1 - (linesLeft / gFileLength)) * 100), "ul");
        }        
        setTimeout(function()
        {
            uploadLoop(action);
        }, wait);
    }
}

function prepareLineToSend() {
    var i = 0;
    var line = "";
    var encodedLine;

    while (gFile.length > 0 && i < maxUploadCommands) {
        encodedLine = encodeURIComponent(gFile[0]) + "%0A";
        if (line.length + encodedLine.length <= buffer) {
            line += encodedLine;
            charsSent += gFile[0].length;
            gFile.shift();
            i++;
        } else {
            line = line.substr(0, line.length - 3);
            break;
        }
    }
    //lineLenStore.push(line.length);
    //bufferStore.push(buffer);
    return line;
}

function uploadFinished(action) {
    var duration = (timer() - timerStart).toHHMMSS();
    switch (action) {
        case "print":
            webPrinting = false;
            message("success", "Finished web printing " + gFilename + " in " + duration);
            break;
        case "upload":
            $.askElle('gcode', "M29");
            listGFiles();
            $('span#ulTitle').text(gFilename + " Upload Complete in " + duration);
            $('div#modal button#modalClose').removeClass('hidden');
            message("info", gFilename + " Upload Complete in " + duration);
            if (printType == "uploadandprint") {
                $('div#modal').modal('hide');
                printSDfile(tempfilename);
                printType = "";
            }
            break;
        case "config":
        case "htm":
            $.askElle('gcode', "M29");
            $.askElle("gcode", "M503"); //update config.g on setting view
            message("info", gFilename + " Upload Complete in " + duration);
            $('span#ulTitle').text(gFilename + " Upload Complete in " + duration);
            $('div#modal button#modalClose').removeClass('hidden');
            maxUploadBuffer = 800;
            maxUploadCommands = 20;
            break;
    }
}

function uploadStats() {
    var d = new Date();
    var elapsed = ((d.getTime() - timerStart) / 1000).toFixed(1);
    var kb = (charsSent / 1024).toFixed(2);
    var kbs = ((charsSent / elapsed) / 1024).toFixed(2)
    $('span#ulStat').text("Sent " + kb + "KB, in " + elapsed + "s, at " + kbs + "KB/s");
}

/**
 * print a G file that is already on the Duet SD card
 * 
 * @param {string} fName - filename of g file to print
 */
function printSDfile(fName)
{
    if (fName != tempfilename){
        resetLayerData();
    }
    printType = 'printfromSD';
    gFilename = fName;
    findHeights();

    $.askElle('gcode', "M23 " + gFilename + "\nM24");
    message('success', "File [" + gFilename + "] sent to print");
    $('span#gFileDisplay').html('<strong>Printing ' + gFilename + ' from Duet SD card</strong>');

    $('#tabs a:eq(1)').tab('show');
}

/**
 *  display the uploding file modal progress box 
 */
function uploadModal() {
    modalMessage('File Upload Status',
            "<span id='ulTitle'>File Upload Status</span><br /><span id='ulStat'></span>" +
            "<div class='progress text-center'>" +
            "<div id='ulProgress' class='progress-bar' role='progressbar' aria-valuenow='0' aria-valuemin='0' aria-valuemax='100' style='width: 0%'>" +
            "</div></div>",
            false);
}

/**
 * upload button click Filereader (opposed to file drop reader)
 * 
 * @param {string} file - filename
 * @param {function} onLoadCallback - callback function
 */
function readFile(file, onLoadCallback) {
    //read file from click-choose type printing/upload
    var reader = new FileReader();
    reader.onload = onLoadCallback;
    reader.readAsText(file);
}

/**
 * examine G1 Z code in a gfile storing the last 3, last == obj height, two previous for layer height
 *
 */
function findHeights() {
    var height = [];
    switch (printType) {
        case 'directprint':
        case 'uploadandprint':            
            height = findHeightsInG();
            var fil = findOtherGMeta();
            height['objTotalFilament'] = fil;
            break;
        case 'printfromSD':
            //do /rr_fileinfo?name= and handle response
            var info = $.askElle('fileinfo', gFilename);
            if (typeof info != 'undefined')
            {
                if (isNumber(info.height))
                    height['objHeight'] = info.height;
                if (isNumber(info.filament))
                    height['objTotalFilament'] = info.filament;
            }
            break;
    }

    //set global height
    layerHeight = height['layerHeight'] ? height['layerHeight'] : storage.get('settings', 'layerHeight');
    objHeight = height['objHeight'];
    objTotalFilament = height['objTotalFilament'];
    updateHeightsDisplay();
}

function updateHeightsDisplay() {
    $('input#objheight').val(objHeight);
    $('span#lyrHeight').text(layerHeight);
    $('span#filTotal').text(objTotalFilament);
}

/**
 * Search last X lines of G code looking for teh last 3 G1 Z commands
 * @returns {object} - containing layer and object height
 */
function findHeightsInG() {
    var height = [];
    var currentLine = gFile.length - 1;
    var readUntilLine = gFile.length - 2000; //last 400
    //work backwords from end of the file until 400 or 3 G1 Z commands found
    while (height.length < 3 && currentLine > readUntilLine) {
        //get last 3 G1 Z commands
        var searchPos = gFile[currentLine].search(/^G1\sZ[0-9]*\.?[0-9]+/i);
        if (searchPos >= 0) {
            end = gFile[currentLine].indexOf(' ', 4);
            if (end > 0) {
                height.push(gFile[currentLine].substr(4, end - 4));
            } else {
                height.push(gFile[currentLine].substr(4));
            }
            end = 0;
        }
        currentLine--;
    }
    return {'objHeight': height[0], 'layerHeight': parseFloat(Math.round((height[1] - height[2]) * 100) / 100).toFixed(2)};
}

/**
 * Search in these lines of G code 
 * append search hits to table on print status tab
 * @returns {undefined}
 */
function findOtherGMeta() {
    var meta = [];
    var fil;

    //work from start
    var currentLine = 0;
    var readUntilLine = 20; //first 20 lines
    while (currentLine < readUntilLine) {
        meta = readLine(gFile[currentLine]);
        meta ? $('table#slic3r tbody').append('<tr><td>' + meta[0] + '</td><td>' + meta[1] + '</td></tr>') : false;
        currentLine++;
    }

    //work backwords from end of the file
    var currentLine = gFile.length - 1;
    var readUntilLine = gFile.length - 100; //last 100 lines
    while (currentLine > readUntilLine) {
        meta = readLine(gFile[currentLine]);
        if (meta[0] == 'Total Filament') {
            fil = parseLine('', 'mm', meta[1]);
        }
        if (meta.length > 0) {
            $('table#slic3r tbody').append('<tr><td>' + meta[0] + '</td><td>' + meta[1] + '</td></tr>');
        }
        currentLine--;
    }
    return fil;
}

/**
 * Search for text in {string} return chars between [ X, Y ]
 * @param {string} string
 * @returns {Array}
 */
function readLine(string) {
    var searchLineFor = {
        'Sliced With': ['generated by ', ' on'],
        'Layer Height': ['layer_height = ', ''],
        'Extrusion Multiplier': ['extrusion_multiplier = ', ''],
        'Perimeter Width': ['perimeters extrusion width =', 'mm'],
        'Total Filament': ['filament used = ', '']
    };

    for (var key in searchLineFor) {
        var value = searchLineFor[key];
        if (string && string.length > 0) {
            var linePos = string.indexOf(value[0]);
            if (linePos > 0) {
                return [key, parseLine(value[0], value[1], string)];
            }
        }
    }
    return false;
}



/**
 * ask Ormerod for a list of the files on its Duet SD
 * and then populate the gfile List Tab in the Interface
 * 
 */
function listGFiles() {
    var count = 0;
    var filesPerCol;
    var list = "gFileList";
    $('div#gFileList, div#gFileList2, div#gFileList3').html("");
    var result = $.askElle("files", "");
    result.files.sort(function(a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    result.files.length > 18 ? filesPerCol = Math.ceil(result.files.length / 3) : filesPerCol = 6;
    result.files.forEach(function(item) {
        count++;
        switch (true) {
            case (count > (filesPerCol * 2)):
                list = "gFileList3";
                break;
            case (count > filesPerCol):
                list = "gFileList2";
                break;
        }
        if (jQuery.inArray(item, macroGs) >= 0) {
            if (!$('div#quicks a[itemprop="M23 ' + item + '%0AM24"]').text()) {
                $('div#quicks td:eq(0)').append('<a href="#" role="button" class="btn btn-default disabled" itemprop="M23 ' + item + '%0AM24" id="quickgfile">' + item + '</a>');
            }
        }
        $('div#' + list).append('<button type="button" class="btn btn-default" id="gFileLink"><span class="pull-left">' + item + '</span><span id="fileDelete" class="glyphicon glyphicon-trash pull-right"></span></button>');
    });
}



/**
 * apply "disabled" css class to a set of UI buttons
 * 
 * @param {string} which 
 */
function disableButtons(which) {
    switch (which) {
        case "head":
            $('table#moveHead button, table#temp button, table#extruder button, table#extruder label, div#quicks a, button#uploadFile').addClass('disabled');
            break;
        case "panic":
            $('div#panicBtn button').addClass('disabled');
            $('button#reset').addClass('hidden');
            break;
        case "gfilelist":
            $('div#gcodefiles button').addClass('disabled');
            break;
        case "sendG":
            $('div#sendG button, div#sendG a, input#gInput').addClass('disabled');
            break;
    }
}

/**
 * remove "disabled" css class to a set of UI buttons
 * 
 * @param {string} which 
 */
function enableButtons(which) {
    switch (which) {
        case "head":
            $('table#moveHead button, table#temp button, table#extruder button, table#extruder label, div#quicks a, button#uploadFile').removeClass('disabled');
            break;
        case "panic":
            $('div#panicBtn button').removeClass('disabled');
            break;
        case "gfilelist":
            $('div#gcodefiles button').removeClass('disabled');
            break;
        case "sendG":
            $('div#sendG button, div#sendG a, input#gInput').removeClass('disabled');
            break;
    }
}

/**
 * Show Modal Popup window
 * 
 * @param {string} title
 * @param {string} text
 * @param {boolean} close
 * 
 */
function modalMessage(title, text, close) {
    $('div#modal h4.modal-title').text(title);
    $('div#modal div.modal-body').html(text);
    close ? $('div#modal button#modalClose').removeClass('hidden') : $('div#modal button#modalClose').addClass('hidden');
    $('div#modal').modal({show: true});
}

/**
 * Logging message
 * @param {string} type - message type
 * @param {string} text - message text
 */
function message(type, text) {
    var d = new Date();
    var time = zeroPrefix(d.getHours()) + ":" + zeroPrefix(d.getMinutes()) + ":" + zeroPrefix(d.getSeconds());
    if (type == 'clear') {
        $('div#messageText').html(time + " <span class='alert-info'>Log Cleared</span><br />");
    } else {
        $('div#messageText').prepend(time + " <span class='alert-" + type + "'>" + text + "</span><br />");
    }
}

/**
 * Handle actions for specfic response content types from the Duet
 * @param {type} res
 * 
 */
function parseResponse(res) {
    switch (true) {
        case res.indexOf('Debugging enabled') >= 0:
            message('info', '<strong>M111</strong><br />' + res.replace(/\n/g, "<br />"));
            break;
        case res.indexOf('Firmware') >= 0:
            var strt = res.indexOf("SION:") + 5;
            var end = res.indexOf(" ELEC");
            currFWver = res.substr(strt, end - strt);
            if ($('p#firmVer').text() === "") {
                $('p#firmVer').text(currFWver);
            }
            message('info', '<strong>M115</strong><br />' + res.replace(/\n/g, "<br />"));
            $.askElle("gcode", "M105");
            if (storage.get('settings', 'verwarn') != 1)
                checkVersions();
            break;
        case res.indexOf('M550') >= 0:
            message('info', '<strong>M503</strong><br />' + res.replace(/\n/g, "<br />"));
            $('div#config').html("<span class='col-md-9'><br/><strong>Config.g File Contents:</strong></span>");
            res.split(/\n/g).forEach(function(item) {
                $('div#config').append("<span class='alert-info col-md-9'>" + item + "</span><br />");
            });
            $.askElle("gcode", "M105");
            break;
        case res == "ok":
            if ($('div#messages input#noOK').is(':checked')) {
                message('info', res);
            }
            break;
        default:
            message('info', res);
            break;
    }
}

/**
 * Handle the homed Axis responses and apply warning messages
 * @param {type} x
 * @param {type} y
 * @param {type} z
 */
function homedWarning(x, y, z) {
    if ((x + y + z) < 3) {
        $('span#warning').text('*some axes are not homed');
    } else {
        $('span#warning').text('');
    }
    x === 0 ? $('button#homeX').removeClass('btn-primary').addClass('btn-warning') : $('button#homeX').removeClass('btn-warning').addClass('btn-primary');
    y === 0 ? $('button#homeY').removeClass('btn-primary').addClass('btn-warning') : $('button#homeY').removeClass('btn-warning').addClass('btn-primary');
    z === 0 ? $('button#homeZ').removeClass('btn-primary').addClass('btn-warning') : $('button#homeZ').removeClass('btn-warning').addClass('btn-primary');
}

function poll() {
    if (polling) {
        setTimeout(function() {
            updatePage();
            poll();
        }, pollFreq);
    }
}

/**
 * Main page update function called by poll() loop function every 1000ms
 * Set inteface elements to reflect Ormerods current state based on status response from duet
 * 
 */
function updatePage() {
    var status = $.askElle("status", "");
    if (!status || !polling) {
        //Not connected, no status respone or poll loop not running
        $('button#connect').removeClass('btn-warning').removeClass('btn-success').addClass('btn-danger');
        $('button#printing').removeClass('btn-warning').removeClass('btn-success').addClass('btn-danger').text("Disconnected");
        if (polling) {
            message('danger', "<strong>Warning!</strong> Ormerod webserver is probably broken, power cycle/reset your Duet Board :(");
            $('button#connect').text("Retrying");
        } else {
            message('info', "<strong>Disconnected</strong> Page not being updated");
            $('button#connect').text("Connect");
        }
        $('span[id$="Temp"], span[id$="pos"]').text("0");
        disableButtons("head");
        disableButtons("panic");
    } else {
        $('button#connect').removeClass('btn-danger').removeClass('btn-warning').addClass('btn-success').text("Online");
        //Connected Hoorahhh!
        if (messageSeqId !== status.seq) //see if this response is a new message e.g. has a different sequence id
        {
            messageSeqId = status.seq;
            parseResponse(status.resp);
        }
        buffer = status.buff;
        homedWarning(status.homed[0], status.homed[1], status.homed[2]);

        switch (true) {
            case status.status == "S":
                //stopped
                printing = false;
                $('button#printing').removeClass('btn-danger').removeClass('btn-success').addClass('btn-warning').text("Halted");
                disableButtons('panic');
                disableButtons("head");
                disableButtons("gfilelist");
                break;
            case status.status === "P" || (webPrinting && !paused):
                //printing
                printing = true;
                $('button#printing').removeClass('btn-danger').removeClass('btn-warning').addClass('btn-success').text("Active");
                enableButtons('panic');
                disableButtons("head");
                disableButtons("gfilelist");
                updatePrintingStats(status.extr[0], status.pos[2]);
                break;
            case status.status === "I" && !paused:
                //inactive, not printing
                printing = false;
                $('button#printing').removeClass('btn-danger').removeClass('btn-success').addClass('btn-warning').text("Ready :)");
                disableButtons("panic");
                enableButtons('head');
                enableButtons("gfilelist");
                break;
            case status.status === "I" && paused:
                //inactive, paused 
                printing = true;
                $('button#printing').removeClass('btn-danger').removeClass('btn-success').addClass('btn-warning').text("Paused");
                enableButtons('panic');
                enableButtons('head');
                break;
            default:
                //unknown state
                webPrinting = printing = paused = false;
                $('button#printing').removeClass('btn-warning').removeClass('btn-success').addClass('btn-danger').text("Error!");
                message('danger', 'Unknown Poll State : ' + status.status);
                break;
        }

        $('span#bedTemp').text(status.heaters[0]);
        $('span#headTemp').text(status.heaters[1]);
        $('span#Xpos').text(status.pos[0]);
        $('span#Ypos').text(status.pos[1]);
        $('span#Zpos').text(status.pos[2]);
        $('span#Epos').text(status.pos[3]);
        $('span#probe').text(status.probe);

        //Temp chart stuff
        chartData[0].push(parseFloat(status.heaters[0]));
        chartData[1].push(parseFloat(status.heaters[1]));
        chart.setData(parseChartData());
        chart.draw();
    }
}

/**
 * We are printing, update the print job status e.g. current layer, current filament use
 * 
 * @param {type} filpos
 * @param {type} zpos
 * @returns {undefined}
 */
function updatePrintingStats(filpos, zpos) {
    currentFilamentPos = filpos;
    currentLayer = whichLayer(zpos);

    if (isNumber(objHeight)) {
        layerCount = Math.ceil(objHeight / layerHeight);
        $('span#lyrCount').text(currentLayer + ' of ' + layerCount);
        $('span#filUsed').text(currentFilamentPos);
        if (layerCount > 0) setProgress(Math.floor((currentLayer / layerCount) * 100), 'print');
    } else {
        objHeight = $('input#objheight').val();
        setProgress(0, 'print', 0, 0);
        $('span#lyrCount').text(currentLayer + ' of ??');
    }
    
    layers(currentLayer);
}

function estEndTime() {
    var d = new Date();
    var utime = d.getTime();
    var layerLeft = layerCount - currentLayer;

    //Layer based estimate
    switch (true) {
        case layerData.length > 2 && layerData.length <= 7 && layerCount > 0:
            //based on last layer time
            var lastLayer = layerData[layerData.length - 1] - layerData[layerData.length - 2];
            var llTimeR = new Date(utime + (lastLayer * layerLeft));
            $('span#llTimeR').text((lastLayer * layerLeft).toHHMMSS());
            $('span#llTime').text(llTimeR.toLocaleTimeString());            
            break;
        case layerData.length > 7 && layerCount > 0:
            t = 0;
            for (var i = 2; i <= 6; i++) {
                t += layerData[layerData.length - i] - layerData[layerData.length - i - 1];
            }
            var avg5 = t / 5;
            var avg5R = new Date(utime + (avg5 * layerLeft));
            $('span#llTimeR').text((avg5 * layerLeft).toHHMMSS());
            $('span#llTime').text(avg5R.toLocaleTimeString());            
            break;
    }
    
    //Filament based Estimate
    if (objTotalFilament > 0 && currentFilamentPos)
    {
        if (currentFilamentPos - startingFilamentPos < objUsedFilament - 10) {
            //probably just done a G30 E0 to reset the filament origin
            startingFilamentPos = currentFilamentPos - objUsedFilament;
        }
        
        objUsedFilament = currentFilamentPos - startingFilamentPos;
        if (objUsedFilament <= objTotalFilament && objUsedFilament > objTotalFilament * 0.05) {	//if at least 5% filament consumed
            var timeSoFar = utime - printStartTime;
            var timeLeft = timeSoFar * (objTotalFilament - objUsedFilament) / objUsedFilament;
            var estiEndTime = new Date(utime + timeLeft);
            $('span#filTimeR').text(timeLeft.toHHMMSS());
            $('span#filTime').text(estiEndTime.toLocaleTimeString());
        }
    }
}

/**
 * current Z pos divided by layer height should equal current layer
 * 
 * @param {int} currZ - current Z axis position
 * @returns {Number} 
 */
function whichLayer(currZ) {
    if (!layerHeight) layerHeight = storage.get('settings', 'layerHeight');
    var n = Math.round(currZ / layerHeight); //calc new layer number
    if (n === currentLayer + 1 && currentLayer) {
        layerChange();
    }
    return n;
}

function resetLayerData() {
    //clear layer count,times and chart
    layerData = [];
    printStartTime = null;
    startingFilamentPos = currentFilamentPos;
    objUsedFilament = 0;
    
    setProgress(0, 'print', 0, 0);
    
    //clear meta data from print status page
    $('span#elapsed, span#lastlayer, table#finish span').text("00:00:00");
    $('span#lyrHeight, span#lyrCount, span#filTotal, span#filUsed').text('0');
    $('#slic3r tbody').html('');
    
    //clear layer chart
    chart2.setData(parseLayerData());
    chart2.setupGrid();
    chart2.draw();
}

/**
 * On new layer, update chart, end estimate
 * 
 * @returns {undefined}
 */
function layerChange() {
    var d = new Date();
    var utime = d.getTime();
    layerData.push(utime);
    if (printStartTime && layerData.length > 1) {
        var lastLayerEnd = layerData[layerData.length - 2];
        $('span#lastlayer').text((utime - lastLayerEnd).toHHMMSS());
        thisLayerTime = utime;
        
        //add layer chart point
        chart2.setData(parseLayerData());
        chart2.setupGrid();
        chart2.draw();

        if (isNumber(objHeight)) {
            estEndTime();
        }
    }
}

/**
 * Layer time stat update function
 * @param {int} layer - layer number
 * @returns {undefined}
 */
function layers(layer) {
    var d = new Date();
    var utime = d.getTime();
    if ((layer === 1) && !printStartTime) {
        //print started on layer 1 now
        printStartTime = thisLayerTime = utime;
        $('span#starttime').text(d.toLocaleTimeString());
        layerData.push(utime);
    }
    if (printStartTime) {
        $('span#elapsed').text((utime - printStartTime).toHHMMSS());
        $('span#thislayer').text((utime - thisLayerTime).toHHMMSS());
    }
}

function zeroPrefix(num) {
    var n = num.toString();
    if (n.length === 1) {
        return "0" + n;
    }
    return n;
}

function setProgress(percent, bar) {
    $('div#' + bar + 'Progress').text(percent + "% Complete").css("width", percent + "%").attr('aria-valuenow', percent);
}

function parseLayerData() {
    if (layerData.length > maxLayerBars)
        layerData.shift();
    var res = [];
    //res.push([0,0]);
    var elapsed;
    for (var i = 1; i < layerData.length; ++i) {
        elapsed = Math.round((layerData[i] - layerData[i - 1]) / 1000);
        res.push([i, elapsed]);
    }
    return [res];
}

function parseChartData() {
    if (chartData[0].length > maxDataPoints)
        chartData[0].shift();
    if (chartData[1].length > maxDataPoints)
        chartData[1].shift();
    var res = [[], []];
    for (var i = 0; i < chartData[0].length; ++i) {
        res[0].push([i, chartData[0][i]]);
        res[1].push([i, chartData[1][i]]);
    }
    return res;
}

function getHTMLver() {
    return document.title.substr(document.title.indexOf("v") + 1);
}

// *** General Helper Functions ***//

Number.prototype.toHHMMSS = function() {
    var h, m;
    var sec_num = Math.floor(this / 1000); // don't forget the second param
    var hours = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);
    hours < 10 ? hours = "0" + hours : false;
    minutes < 10 ? minutes = "0" + minutes : false;
    seconds < 10 ? seconds = "0" + seconds : false;
    hours == '00' ? h = "" : h = hours + "h ";
    minutes == '00' ? m = "" : m = minutes + "m ";
    return h + m + seconds + 's';
};

function isNumber(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

function timer() {
    var d = new Date();
    if (!timerStart) {
        timerStart = d.getTime();
    } else {
        var elapsed = d.getTime() - timerStart;
        timerStart = null;
        return elapsed;
    }
}

function getFileExt(filename) {
    return filename.split('.').pop();
}

function getFileName(filename) {
    return filename.split('.').shift();
}

/**
 * substring line between two text strings
 * 
 * @param {string} needle_b4
 * @param {string} needle_af
 * @param {string} haystack
 * @returns {string}
 */
function parseLine(needle_b4, needle_af, haystack) {
    var startPos = needle_b4 == '' ? 0 : haystack.indexOf(needle_b4) + needle_b4.length;
    var endPos = needle_af == '' ? haystack.length : haystack.indexOf(needle_af);
    var len = endPos - startPos;
    var result = haystack.substr(startPos, len);
    return result;
}

