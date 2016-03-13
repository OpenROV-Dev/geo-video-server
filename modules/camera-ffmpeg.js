var events = require('events');  
const glob = require("glob");

var Camera = function(){
  var exec = require('child_process').exec;
  var fs = require('fs');

  var mxcam_command = "mxcam";
  var mxuvc_command = "mxuvc";
  var init_camera_script = "./platform/linux/bootcamera.sh";
  
  this.video = null;
  this.status = 'initializing';

  events.EventEmitter.call(this);
  var self=this;
  var child = exec(init_camera_script, function(err, stdout, stderr) {
      if (err) {
        console.log(stderr);
        console.log(stdout);
        console.dir(err);
        throw err;
        //TODO: handle the 1004 exit code: No Geo Camera found
      };
      var _this = self;
      glob("/dev/v4l/by-id/usb-GEO_Semi_Condor*", function (er, files) {
          if (er) throw er;
          
      // At the moment the system assumes /dev/video0.  We actually
      // need to determine which concern needs to pick the actual camera
      // to stream, assuming more than one Geo Camera.
      _this.video = require("geomux");
      _this.status = 'ready';
      _this.emit('ready');

      });      
  });  
  
}

Camera.prototype.__proto__ = events.EventEmitter.prototype;

module.exports=new Camera();