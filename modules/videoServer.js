function video(deps) {

  //instance variables
  this.deps = deps; //hold a reference to the plugin dependencies if you are going to use them
  this.io = deps.socketIOclient; //explicitlly calling out the rov eventemitter

  var self = this; //set closure state variable for use in functions
  
  this.h264stream = deps.video.videoStream;

  var dps = 0;
  
  this.h264stream.on('data', function(data) {
    self.io.compress(false).volatile.emit('x-h264-video.data', data);
    dps++;
  });

  setInterval(function() {
    console.log('dps: ' + dps);
    dps = 0
  }, 1000);
  
  this.io.on('connect',function(client){
    client.on('request_Init_Segment', function(fn) {
      fn(new Buffer(self.deps.video.initFrame, 'binary'));
    })  
  });

  this.h264stream.on('close', function(code) {
    console.log('x-video-camera stopped code:' + code);
  });

}

// This is all that is required to enable settings for a plugin. They are
// automatically made editable, saved, etc from this definition.
video.prototype.getSettingSchema2 = function getSettingSchema() {
  //from http://json-schema.org/videos.html
  return [{
    "title": "Video Settings",
    "type": "object",
    "id": "video", //Added to support namespacing configurations
    "properties": {
      "forward_camera_url": {
        "type": "string",
        "default": "/rov/forward-camera" //Added default
      },
      "framerate": {
        "type": "number",
        "default": "30" //Added default
      },
      "resolution": {
        "type": "string",
        "default": "1280x720",
        "enum": ["1920x1080", "1600x900", "1360x768", "1280x720", "1024x768", "800x600"]
      }
    }
  }];
};

module.exports = function(deps) {
  return new video(deps);
};
