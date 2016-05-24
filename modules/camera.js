var zmq		        = require('zmq');
var EventEmitter    = require('events').EventEmitter;
var util            = require('util');

var Camera = function( cameraOffset, deps )
{
    EventEmitter.call(this);
    
    var self        = this;
    this.offset     = cameraOffset;
    this.deps       = deps;
    this.commandPub = zmq.socket( 'pub' );
    
    var channels    = {};
    var plugin      = deps.plugin;
    
    // Handle command requests for this camera from the cockpit plugin
    this.on( "command", function( command, params )
    {
        if( command == "chCmd" )
        {
            // Channel level commands
            var channel = params.channel;
            
            if( channels[ channel ] !== undefined )
            {
                channels[ channel ].emit( "command", params.command, params.params );
            }
        }
        else
        {
            // Camera level commands
            SendCommand( command, params )
        } 
    } );
    
    // Handle channel registrations
    this.on( "channel_registration", function( channelNum, callback )
	{
        try
        {
            // Create a channel object
            channels[ channelNum ] = require( "channel.js" )( self, channelNum );
            
            // Call success callback
            callback();
        }
        catch( err )
        {
            throw "Channel registration failed: " + err;
        }
    } );
    
    // Connect to geomuxpp command socket
    this.commandPub.connect( "ipc:///tmp/geomux_command" + cameraOffset + ".ipc" );
    
    // Announce this camera's creation
    plugin.emit( "geomux.camera.announce", cameraOffset );
    
    // ----------------
	// Helper functions
    	
	function SendCommand( command, params )
	{
		// Send channel command over zeromq to geomuxpp
		self.commandPub.send( 
		[ 
			"cmd",
			JSON.stringify(
			{
				cmd: command,
				params: params
			} ) 	
		] );
	};
};
util.inherits(Camera, EventEmitter);

module.exports = function( cameraOffset, deps ) 
{
    return new Camera( cameraOffset, deps );
};