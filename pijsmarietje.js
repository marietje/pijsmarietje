(function(){

//
// Misc utility functions
//

function create_tr(data) {
        n_tr = document.createElement('tr');
        for(var i = 0; i < data.length; i++) {
                n_td = document.createElement('td');
                n_td.appendChild(document.createTextNode(data[i]));
                n_tr.appendChild(n_td);
        }
        return n_tr;
};

function zpad_left(tmp, n) {
        var pad = '';
        for (var i = tmp.length; i < n; i++)
                pad += '0';
        return pad + tmp;
}

function nice_time(tmp) {
        neg = tmp < 0;
        if(neg) tmp = -tmp;
        var sec = parseInt(tmp % 60);
        tmp /= 60;
        var min = parseInt(tmp % 60);
        var hrs = parseInt(tmp / 60);
        if(hrs == 0)
                var ret = min.toString() + ':' + zpad_left(sec.toString(), 2);
        else
                var ret = hrs.toString() + ':' +
                                zpad_left(min.toString(), 2) + ':' +
                                zpad_left(sec.toString(), 2);
        if(neg) ret = '-' + ret;
        return ret;
}

//
// Main PijsMarietje class
//
function PijsMarietje() {
        this.after_login_cb = null;
        this.uploader = null;
        this.logged_in = false;
        this.login_token = null;
        this.channel_ready = false;
        this.comet = null;
        this.channel = null;
        this.media = {};
        this.media_count = 0;
        
        this.updating_times = false;

        this.got_media = false;
        this.got_requests = false;
        this.got_playing = false;

        this.waiting_for_login_token = false;
        this.waiting_for_welcome = true;
        this.waiting_for_logged_in = false;
        this.waiting_for_media = 0;
        this.msg_map = {
                'welcome': this.msg_welcome,
                'login_token': this.msg_login_token,
                'logged_in': this.msg_logged_in,
                'error_login': this.msg_error_login,
                'media': this.msg_media,
                'media_part': this.msg_media_part,
                'requests': this.msg_requests,
                'playing': this.msg_playing};
}

PijsMarietje.prototype.run = function() {
        this.setup_ui();
        this.setup_joyce();
};

PijsMarietje.prototype.setup_joyce = function() {
        var that = this;
        this.comet = new joyceCometClient({
                'host': '192.168.1.3'});

        this.channel = this.comet.create_channel({
                'message': function(msg) {
                        var t = msg['type'];
                        if(t in that.msg_map)
                                that.msg_map[t].call(that, msg);
                        else
                                console.warn(["I don't know how to handle",
                                                msg]);
                }, 'ready': function() {
                        that.on_channel_ready();
                }});
};

//
// Message handlers
//

PijsMarietje.prototype.msg_playing = function(msg) {
        var that = this;
        console.log(msg);
        this.got_playing = true;
        this.playing = msg.playing;
        this.playing.requestTime = new Date().getTime() / 1000.0;
        this.refresh_requestsTable();
        if(!this.updating_times) {
                this.updating_times = true;
                setInterval(function() {
                        that.update_times();
                }, 1000);
        }
};

PijsMarietje.prototype.msg_media = function(msg) {
        var that = this;
        this.media = {};
        this.media_count = 0;
        this.waiting_for_media = msg.count;
        this.got_media = false;
        $.jGrowl('Receiving media<br/> <span class="media-received">0</span>/' 
                        + msg.count.toString(), {
                        sticky: true,
                        theme: 'media-not',
                        open: function() {
                                if(that.got_media) {
                                        return false;
                                }
                        }});
};

PijsMarietje.prototype.msg_media_part = function(msg) {
        for(var i = 0; i < msg.part.length; i++) {
                this.media[msg.part[i].key] = msg.part[i];
        }
        this.media_count += msg.part.length;
        this.waiting_for_media -= msg.part.length;
        $('.media-received').text(this.media_count);
        if(this.waiting_for_media == 0) {
                this.on_got_media();
        }
};

PijsMarietje.prototype.msg_login_token = function(msg) {
        this.login_token = msg['login_token'];
        this.on_login_token();
};

PijsMarietje.prototype.msg_welcome = function(msg) {
        if(this.waiting_for_welcome) {
                this.waiting_for_welcome = false;
                $('#welcome-dialog').dialog('close');
        }
};

PijsMarietje.prototype.msg_logged_in = function(msg) {
        if(this.waiting_for_logged_in) {
                this.waiting_for_logged_in = false;
                $('#loggingin-dialog').dialog('close');
                if(this.logged_in)
                        return;
                this.logged_in = true;
                if(this.after_login_cb != null)
                        this.after_login_cb();
        }
};


PijsMarietje.prototype.msg_error_login = function(msg) {
        if(this.waiting_for_logged_in) {
                this.waiting_for_logged_in = false;
                $('#loggingin-dialog').dialog('close');
                this.prepare_login();
                $('#login-dialog .error-msg').text(msg.message);
                $('#login-dialog .error-msg').show();
        }
};

PijsMarietje.prototype.msg_requests = function(msg) {
        this.requests = msg.requests;
        this.got_requests = true;
        this.refresh_requestsTable();
};

PijsMarietje.prototype.on_got_media = function(msg) {
        this.got_media = true;
        $('.media-not .jGrowl-close').trigger('click');
        console.info('Received '+this.media_count.toString()+' media');
        if(this.got_requests || this.got_playing)
                this.refresh_requestsTable();
};


PijsMarietje.prototype.refresh_requestsTable = function() {
        $('#requestsTable').empty();
        this.fill_requestsTable();
};

PijsMarietje.prototype.fill_requestsTable = function() {
        var t = $('#requestsTable');
        var start = (this.got_playing ? -1 : 0);
        var end = (this.got_requests ? this.requests.length : 0);
        var ctime = null;
        for(var i = start; i < end; i++) {
                var m = (i == -1 ? this.playing.mediaKey
                                : this.requests[i].mediaKey);
                var b = (i == -1 ? this.playing.byKey
                                : this.requests[i].byKey);
                if(!b)
                        b = 'marietje';
                var txt_a = m;
                var txt_t = '';
                if(this.got_media) {
                        txt_a = this.media[m].artist;
                        txt_t = this.media[m].title;
                }
                ctime = (i == -1 ? 0 :
                                (this.got_media ?
                                 ctime + this.media[m].length : 0));
                tr = create_tr([b, txt_a, txt_t,
                                (ctime == null ? '' : ctime)]);
                $(tr).data('offset', ctime);
                $('td:eq(0)',tr).addClass('by');
                $('td:eq(1)',tr).addClass('artist');
                $('td:eq(2)',tr).addClass('title');
                $('td:eq(3)',tr).addClass('time');
                t.append(tr);
        }
};

PijsMarietje.prototype.on_channel_ready = function() {
        // Create uploader
        this.uploader = new qq.FileUploader({
                element: $('#uploader')[0],
                action: this.channel.stream_url});

        // Request list of media
        this.channel.send_messages([
                {'type': 'list_media'},
                {'type': 'list_requests'},
                {'type': 'get_playing'}]);
};

PijsMarietje.prototype.prepare_login = function() {
        if(this.waiting_for_login_token)
                return;
        if(this.login_token == null) {
                this.waiting_for_login_token = true;
                this.channel.send_message({
                        type: 'request_login_token' });
                $('#login-token-dialog').dialog('open');
        } else
                $('#login-dialog').dialog('open');
};

PijsMarietje.prototype.on_login_token = function() {
        if(this.waiting_for_login_token) {
                this.waiting_for_login_token = false;
                $('#login-token-dialog').dialog('close');
                $('#login-dialog').dialog('open');
        }
};

PijsMarietje.prototype.do_login = function(username, password) {
        var hash = md5(md5(password) + this.login_token);
        this.waiting_for_logged_in = true;
        $('#loggingin-dialog').dialog('open');
        this.channel.send_message({
                'type': 'login',
                'username': username,
                'hash': hash});
}

PijsMarietje.prototype.update_times = function() {
        var that = this;
        var diff = (this.playing.endTime
                        - new Date().getTime() / 1000.0
                        - this.playing.serverTime
                        + this.playing.requestTime);
        $('#requestsTable tr').each(function(i, tr) {
                var offset = $(tr).data('offset');
                $('.time',tr).text(offset == null ? ''
                        : nice_time(offset + diff));
        });
};

PijsMarietje.prototype.setup_ui = function() {
        var that = this;
        // First, initialize the welcome dialog
        $("#welcome-dialog").dialog({
                autoOpen: that.waiting_for_welcome,
                modal: true,
                closeOnEscape: false,
                beforeClose: function() {
                        return !that.waiting_for_welcome;
                }
        });
        
        // Set up tabs
        $('#tabs').tabs({
                select: function(event, ui) {
                        if(ui.index == 1 && !that.logged_in) {
                                var tabs = $(this);
                                that.after_login_cb = function() {
                                        tabs.tabs('select', 1);
                                };
                                that.prepare_login();
                                return false;
                        }
                        return true;
                }
        });
        $( ".tabs-bottom .ui-tabs-nav, .tabs-bottom .ui-tabs-nav > *" )
                .removeClass( "ui-corner-all ui-corner-top" )
                .addClass( "ui-corner-bottom" );

        // Set up dialogs
        $( "#login-dialog" ).dialog({
                autoOpen: false,
                modal: true,
                buttons: {
                        "Login": function() {
                                $(this).dialog('close');
                                that.do_login($('#username').val(),
                                                $('#password').val());
                        },
                        "Cancel": function() {
                                $(this).dialog("close");
                        }
                }
        });
        $('#login-dialog .error-msg').hide();
        $('#login-dialog').keyup(function(e) {
                if(e.keyCode == 13) {
                        $(this).dialog('option',
                                        'buttons')["Login"].call(this);
                }
        });
        $("#login-token-dialog").dialog({
                autoOpen: false,
                modal: true,
                closeOnEscape: false,
                beforeClose: function() {
                        return !that.waiting_for_login_token;
                }
        });
        $("#loggingin-dialog").dialog({
                autoOpen: false,
                modal: true,
                closeOnEscape: false,
                beforeClose: function() {
                        return !that.waiting_for_logged_in;
                }
        });
}; 

$(document).ready(function(){
        var pijsmarietje = new PijsMarietje();
        pijsmarietje.run();
});

})();
