var joyceCometClient = (function(){

var channel = function(client, settings) {
        this.client = client;
        this.token = null;
        this.queue_out = [];
        this.pending_requests = 0;

        this.message = 'message' in settings ? settings.message : function(){};
        this.stream = 'stream' in settings ? settings.stream : function(){};
        this.ready = 'ready' in settings ? settings.ready : function(){};
        this.stream_url = null;
}

channel.prototype.run = function() {
        this._request(false);
};

channel.prototype._request = function(interrupt) {
        if((interrupt && this.pending_requests >= 2) ||
           (!interrupt && this.pending_requests >= 1))
                return;
        this.pending_requests++;
        var data = [];
        if(this.token != null) {
                data.push(this.token);
                $.merge(data, this.queue_out);
                this.queue_out = [];
        }
        var url = 'http://'+this.client.host+':'+this.client.port.toString()+
                        this.client.path;
        var that = this;
        $.ajax({'jsonp': 'c',
                'url': url,
                'type': 'POST',
                'data': {
                        'm': JSON.stringify(data)
                },
                'dataType': 'jsonp',
                'error': function(xhr, textStatus, errorThrown) {
                        that.on_error(xhr, textStatus, errorThrown);
                }, 'success': function(data, textStatus, xhr) {
                        that.on_success(data, textStatus, xhr);
                }});
};

channel.prototype.on_success = function(data, textStatus, xhr) {
        var became_ready = false;
        this.pending_requests--;
        if(this.token != null && data[0] != this.token) {
                alert('error: token changed: '+this.token+' != ' + data[0]);
                return;
        }
        if(this.token == null) {
                this.token = data[0];
                this.stream_url = 'http://'+this.client.host+':'+
                        this.client.port.toString()+
                        this.client.path+'?m='+this.token; 
                became_ready = true;
        }
        for(var i = 0; i < data[1].length; i++) {
                this.message(data[1][i]);
        }
        // TODO Add support for streams
        this._request(false);

        if(became_ready)
                this.ready();
};

channel.prototype.send_message = function(data) {
        this.queue_out.push(data);
        if(this.token != null)
                this._request(true);
};

channel.prototype.on_error = function(xhr, textStatus, errorThrown) {
        console.error([textStatus,  errorThrown]);
};

var client = function(settings) {
        this.host = 'host' in settings ? settings.host : 'localhost';
        this.port = 'port' in settings ? settings.port : 8080;
        this.path = 'path' in settings ? settings.path : '/';
}

client.prototype.create_channel = function(settings) {
        var ret = new channel(this, settings);
        ret.run();
        return ret;
};

return client;

})();
