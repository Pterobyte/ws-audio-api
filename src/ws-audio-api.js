//    WebSockets Audio API
//
//    Opus Quality Settings
//    =====================
//    App: 2048=voip, 2049=audio, 2051=low-delay
//    Sample Rate: 8000, 12000, 16000, 24000, or 48000
//    Frame Duration: 2.5, 5, 10, 20, 40, 60
//    Buffer Size = sample rate/6000 * 1024

(function(global) {
	var defaultConfig = {
		codec: {
			sampleRate: 24000, // original = 24000
			channels: 1,
			app: 2048, // original = 2048
			frameDuration: 20,
			bufferSize: 4096 // original = 4096
		},
		server: {
			host: window.location.hostname,
			port: 5000
		}
	};

	var audioContext = new(window.AudioContext || window.webkitAudioContext)();

	var WSAudioAPI = global.WSAudioAPI = {
		//Player: function(config, socket) {
		  Player: function(socket) {
			this.config = {};
			this.config.codec = this.config.codec || defaultConfig.codec;
			this.config.server = this.config.server || defaultConfig.server;
			this.sampler = new Resampler(this.config.codec.sampleRate, 44100, 1, this.config.codec.bufferSize);
			this.parentSocket = socket;
			this.decoder = new OpusDecoder(this.config.codec.sampleRate, this.config.codec.channels);
			this.silence = new Float32Array(this.config.codec.bufferSize);
			console.log("PLAYER WITH CONFIG: ",this.config)
		},
		// Streamer: function(config, socket) {
		Streamer: function(socket) {
			navigator.getUserMedia = (
				navigator.getUserMedia ||
				navigator.webkitGetUserMedia ||
				navigator.mozGetUserMedia ||
				navigator.msGetUserMedia ||
				navigator.mediaDevices.getUserMedia
			);

			this.config = {};
			this.config.codec = this.config.codec || defaultConfig.codec;
			this.config.server = this.config.server || defaultConfig.server;
			this.sampler = new Resampler(44100, this.config.codec.sampleRate, 1, this.config.codec.bufferSize);
			this.parentSocket = socket;
			this.encoder = new OpusEncoder(this.config.codec.sampleRate, this.config.codec.channels, this.config.codec.app, this.config.codec.frameDuration);
			var _this = this;
			this._makeStream = function(onError) {
				navigator.getUserMedia({ audio: true }, function(stream) {
					_this.stream = stream;
					_this.audioInput = audioContext.createMediaStreamSource(stream);
					_this.gainNode = audioContext.createGain();
					_this.recorder = audioContext.createScriptProcessor(_this.config.codec.bufferSize, 1, 1);
					_this.recorder.onaudioprocess = function(e) {
						var resampled = _this.sampler.resampler(e.inputBuffer.getChannelData(0));
						var packets = _this.encoder.encode_float(resampled);
						for (var i = 0; i < packets.length; i++) {
							//if (_this.socket.readyState == 1) _this.socket.send(packets[i]);
							if (_this.socket.connected) _this.socket.emit('speak', {array:packets[i]});
							console.log(packets[i]);
						}
					};
					_this.audioInput.connect(_this.gainNode);
					_this.gainNode.connect(_this.recorder);
					_this.recorder.connect(audioContext.destination);
				}, onError || _this.onError);
			}
		}
	};

	WSAudioAPI.Streamer.prototype.start = function(onError) {
		var _this = this;

		if (!this.parentSocket) {
			//this.socket = new WebSocket('wss://' + this.config.server.host + ':' + this.config.server.port);
		} else {
			this.socket = this.parentSocket;
		}

		this.socket.binaryType = 'arraybuffer';
		// this.socket.readyState == WebSocket.OPEN
		if (this.socket.connected) {
			this._makeStream(onError);
		}
		else {
			console.error('Socket is in CLOSED state');
		}

		//var _onclose = this.socket.onclose;
		var _onclose = function(){
			this.socket.emit('disconnect');
			// TODO: take out disconnect event
		}
	};

	WSAudioAPI.Streamer.prototype.mute = function() {
		this.gainNode.gain.value = 0;
		console.log('Mic muted');
	};

	WSAudioAPI.Streamer.prototype.unMute = function() {
		this.gainNode.gain.value = 1;
		console.log('Mic unmuted');
	};

	WSAudioAPI.Streamer.prototype.onError = function(e) {
		var error = new Error(e.name);
		error.name = 'NavigatorUserMediaError';
		throw error;
	};

	WSAudioAPI.Streamer.prototype.stop = function() {
		if (this.audioInput) {
			this.audioInput.disconnect();
			this.audioInput = null;
		}
		if (this.gainNode) {
			this.gainNode.disconnect();
			this.gainNode = null;
		}
		if (this.recorder) {
			this.recorder.disconnect();
			this.recorder = null;
		}
		this.stream.getTracks()[0].stop()

		if (!this.parentSocket) {
			//this.socket.close();
			this.socket.emit('disconnect')
			// TODO: remove disconnect event
		}
	};

	WSAudioAPI.Player.prototype.start = function() {
		var _this = this;

		this.audioQueue = {
			buffer: new Float32Array(0),

			write: function(newAudio) {
				var currentQLength = this.buffer.length;
				newAudio = _this.sampler.resampler(newAudio);
				var newBuffer = new Float32Array(currentQLength + newAudio.length);
				newBuffer.set(this.buffer, 0);
				newBuffer.set(newAudio, currentQLength);
				this.buffer = newBuffer;
			},

			read: function(nSamples) {
				var samplesToPlay = this.buffer.subarray(0, nSamples);
				this.buffer = this.buffer.subarray(nSamples, this.buffer.length);
				return samplesToPlay;
			},

			length: function() {
				return this.buffer.length;
			}
		};

		this.scriptNode = audioContext.createScriptProcessor(this.config.codec.bufferSize, 1, 1);
		this.scriptNode.onaudioprocess = function(e) {
			if (_this.audioQueue.length()) {
				e.outputBuffer.getChannelData(0).set(_this.audioQueue.read(_this.config.codec.bufferSize));
			} else {
				e.outputBuffer.getChannelData(0).set(_this.silence);
			}
		};
		this.gainNode = audioContext.createGain();
		this.scriptNode.connect(this.gainNode);
		this.gainNode.connect(audioContext.destination);

		if (!this.parentSocket) {
			//this.socket = new WebSocket('wss://' + this.config.server.host + ':' + this.config.server.port);
		} else {
			this.socket = this.parentSocket;
		}
	  this.socket.on('getSpeak', function(message, callback){
		  _this.audioQueue.write(_this.decoder.decode_float(message.array));
			console.log(message.array);
    });
  }

  WSAudioAPI.Player.prototype.getVolume = function() {
  	return this.gainNode ? this.gainNode.gain.value : 'Stream not started yet';
  };

  WSAudioAPI.Player.prototype.setVolume = function(value) {
  	if (this.gainNode) this.gainNode.gain.value = value;
  };

  WSAudioAPI.Player.prototype.stop = function() {
  	this.audioQueue = null;
  	this.scriptNode.disconnect();
  	this.scriptNode = null;
  	this.gainNode.disconnect();
  	this.gainNode = null;
		this.socket.emit('disconnect');
  	//if (!this.parentSocket) {
  		//this.socket.close();
  	//} else {
  		//this.socket.onmessage = this.parentOnmessage;
  	//}
  };
})(window);
