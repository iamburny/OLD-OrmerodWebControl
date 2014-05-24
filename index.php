<?php
$layer = 0;
$lyrH = 0.2;
$zpos = $lyrH * $layer;

//var_dump($_SERVER);

//router class
switch ($_SERVER['REDIRECT_URL']) {
    case '/rr_files':
        $response = array("files" => array(
            "duettest.g",
            "setbed.g",
            "box-0.2.gcode",
            "circle.g",
            "square.g",
            "coathook.g",
            "Eiffel_Tower_mini-0.2.gcode",
            "box2-0.2.gcode",
            "Track_Bowl_1-0.2.gcode",
            "rotatingRings (repaired)-0.2.gcode",
            "setbed1.g"));
        break;
    case '/rr_status':
        $response = array(
            'buff' => 900,
            'extr' => array('6212.856'),
            'heaters' => array('60', '201.4'),
            'homed' => array(1, 1, 1),
            'pos' => array(100, 100, $zpos, 0.22),
            'probe' => '51',
            'resp' => 'ok',
            'seq' => 10461,
            'status' => $zpos>0?'P':'I'
        );
        break;
    case '/rr_gcode':
        $response = array(
            'buff' => 900,
            'extr' => array('6212.856'),
            'heaters' => array('60', '201.4'),
            'homed' => array(1, 1, 1),
            'pos' => array(100, 100, $zpos, 0.22),
            'probe' => '51',
            'resp' => 'ok',
            'seq' => 10461,
            'status' => $zpos>0?'P':'I'
        );
        break;
    case '/rr_fileinfo':
        $response = array(
            "size" => 245757,
            "height" => "15.12",
            "filament"=> "4032.1"
        );
        break;
    case '/phpinfo':
        phpinfo();
        break;
    default:
        //header("Location: /reprap.htm");
        break;
}

echo json_encode($response);

