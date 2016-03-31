var events = require('events');


var Camera = function(){
  var spawn = require('child_process').spawn;
  var self = this;

  //test pattern
  var ffmpeg_options = '-f lavfi -i testsrc=size=1920x1080:rate=30 -f mp4 -g 1 -movflags empty_moov+default_base_moof+frag_keyframe -tune zerolatency -';

  this.video = {videoStream : new events.EventEmitter()};
  this.video.initFrame = null;
  this.status = 'initializing';
  console.log('in method');
  events.EventEmitter.call(this);
  var self=this;
  var child = spawn('ffmpeg',ffmpeg_options.match(/\S+/g));

  var dataBuffer = null;
  var initBuffer = null;
  child.stdout.on('data', function(data){
    if (self.video.initFrame == null){
      initBuffer = initBuffer==null ? data : Buffer.concat([initBuffer,data]);
      if (initBuffer < 25) {
        return;
      }

      self.status = 'ready';
      self.emit('ready');
      self.video.initFrame=initBuffer;
      self.video.videoStream.emit('initData',data);
      console.log('initdata');
      return;
    }

    //Crude hack to gather the output from ffmpeg stdout in to full frames before emitting.
    if (data.length==8192){
      dataBuffer=data;
      return;
    }
    dataBuffer = dataBuffer==null ? data : Buffer.concat([dataBuffer,data]);
    self.video.videoStream.emit('data',dataBuffer);
//    console.log('data');
  });
  child.stderr.on('data', function(error){
  //  console.log(error.toString());
  });


}

Camera.prototype.__proto__ = events.EventEmitter.prototype;

module.exports=new Camera();
