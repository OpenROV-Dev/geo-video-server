
var http = location.protocol;
var slashes = http.concat("//");
var host = slashes.concat(window.location.hostname);

var socket = io(host + ':' + 8099);
//var em = new EventEmitter2();
socket.withHistory = socket;

window.addEventListener('WebComponentsReady', function(e) {
    var c1 = document.getElementById("camera1");
    c1.registerEmitterHanlders(socket);
});

/*
socket.on('x-h264-video.data', function (data) {
    em.emit('x-h264-video.data',data);
});

em.on('request_Init_Segment',function(callback){
    socket.emit('request_Init_Segment',callback);
});

*/