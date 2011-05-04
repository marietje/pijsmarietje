(function(){

function PijsMarietje() {
        this.uploader = null;
        this.logged_in = false;
        this.login_token = null;
        this.channel_ready = false;
        this.comet = null;
        this.channel = null;
        this.waiting_for_login_token = false;
        this.waiting_for_welcome = true;
        this.waiting_for_logged_in = false;
        this.msg_map = {
                'welcome': this.msg_welcome,
                'login_token': this.msg_login_token,
                'logged_in': this.msg_logged_in};
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
        }
};

PijsMarietje.prototype.on_channel_ready = function() {
        // Create uploader
        this.uploader = new qq.FileUploader({
                element: $('#uploader')[0],
                action: this.channel.stream_url});

        // Request list of media
        this.channel.send_message({
                'type': 'list_media'});
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
                                that.prepare_login();
                                return false;
                        }
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
                                $('#login-dialog').dialog('close');
                                that.do_login($('#username').val(),
                                                $('#password').val());
                        },
                        "Cancel": function() {
                                $(this).dialog("close");
                        }
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
