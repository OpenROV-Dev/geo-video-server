#!/usr/bin/env node
//To eliminate hard coding paths for require, we are modifying the NODE_PATH to include
//out lib folder
var oldpath = '';
if (process.env['NODE_PATH']!==undefined){
  oldpath = process.env['NODE_PATH'];
}
//just in case already been set leave it alone
process.env['NODE_PATH']=__dirname+'/modules:'+oldpath;
require('module').Module._initPaths();
console.log("Set NODE_PATH to: "+process.env['NODE_PATH'] );

var camera = require("camera.js");
var videoServer;
var io = require('socket.io')(8099);
var fs = require('fs');
var options={'writeToDisk' : false};
const mdns=require('mdns');

var getOptions = function getOptions(args){
    var defaults = {
        location: process.env.LOCATION || "forward",
        port: process.env.PORT || 8099,
        fps: process.env.FPS || 30,
        mimeType: process.env.MIMETYPE || 'video/mp4',
        resolution: process.env.RESOLUTION || '1920x1080',
        device: process.env.DEVICE || '/dev/video0'
    };
    var argv = require('minimist')(args);
    return Object.assign(defaults,argv);
}

options = getOptions(process.argv.slice(2));

camera.on('ready',function(){
    var deps = {};
    deps.video = camera.video;
    
    deps.socketIOclient = io;
    var stream;
    camera.video.videoStream.on('initData', function(data){
        console.log("got init data");
        deps.video.initFrame = data;

        //The stream is up and running now.
        videoServer = require('videoServer')(deps);
        mdns = require('mDNS-SD')('geomux',options.port,{resolution: options.resolution, framerate: options.framerate, videoMimeType: 'video/mp4', cameraLocation: options.location, relativeServiceUrl:options.url});
        
        if (options.writeToDisk){
            //Todo: Verify the async writes preserve order. First test appeared to be a corrupt stream.  Could also simply need to have encoding set.
            stream = fs.createWriteStream("/tmp/video.mp4");
            stream.write(data);
        }
    });
    
    camera.video.videoStream.on('data', function(data){
        if (stream!==undefined){
            stream.write(data);
        };
    });    

});
