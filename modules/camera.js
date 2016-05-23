var zmq		        = require('zmq');
var EventEmitter    = require('events').EventEmitter;
var util            = require('util');

var Camera = function( cameraOffset, regServer )
{
    EventEmitter.call(this);
    
    var self                = this;
    this.offset             = cameraOffset;
    this.channels           = {};
    
    var registrationServer = regServer;
    
    // Helper function
    var GetCamChannelString = function( channelNum )
    {
        return ( "[" + self.offset + "][" + channelNum + "]: " );
    };
    
    /////////////
    // Set up channel status subscribers
    this.commandPublisher   = zmq.socket( 'pub' );  // Sends commands to geomuxpp
 
    // Connect ZMQ sockets
    this.commandPublisher.connect( "ipc:///tmp/geomux_command" + self.offset + ".ipc" );

    // Channel registrations
    registrationServer.on( 'message', function( msg )
	{
        var registration = JSON.parse( msg );

        if( registration.type === "channel_registration" )
		{
			console.log( "Channel[" + registration.channel + "] added on camera [" + registration.camera + "]" );
		
			// Create a channel object
            self.channels[ registration.channel ] = require( "channel.js" )( self, registration.channel );
			
			// Tell the daemon that it is good to go
			registrationServer.send( JSON.stringify( { "response": 1 } ) );
            
            self.channels[ registration.channel ].emit( "start_video" );
		}
    } );
};
util.inherits(Camera, EventEmitter);

module.exports = function( cameraOffset, regServer ) 
{
    return new Camera( cameraOffset, regServer );
};