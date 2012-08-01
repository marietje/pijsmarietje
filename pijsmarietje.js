(function(){

if(typeof Function.empty == 'undefined')
        Function.empty = function(){};

if(typeof console == 'undefined')
        console = {
                'log': Function.empty,
                'debug': Function.empty,
                'info': Function.empty,
                'warn': Function.empty,
                'error': Function.empty,
                'assert': Function.empty
        };

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
        this.after_login_token_cb = null;
        this.uploader = null;
        this.logged_in = false;
        this.login_token = null;
        this.channel_ready = false;
        this.comet = null;
        this.channel = null;
        this.media = {};
        this.media_count = 0;
        
        this.updating_times = false;

        this.got_requests = false;
        this.got_playing = false;

        this.waiting_for_login_token = false;
        this.waiting_for_welcome = true;
        this.waiting_for_logged_in = false;

        this.re_queryCheck = /^[a-z0-9 ]*$/;
        this.re_queryReplace = /[^a-z0-9 ]/g;

        /* State for the media queries */
        this.qm_showing_results = false;
        this.qm_current_query = '';
        this.qm_results_offset = null;
        this.qm_token = 0;
        this.qm_results_requested = 20;
        this.qm_has_more_results = true;
        this.qm_request_outstanding = false;
        this.qm_has_delayed_query = false;

        this.scroll_semaphore = 0;
        this.mainTabShown = true;

        // requestsToolbox
        this.rtb_el = $('#requestsToolbox');
        this.rtb_key = null;
        this.rtb_visible = true;
        this.rtb_over_playing = false;
        this.rtb_hideTimeout = null;

        // Media queries history
        this.qmh_entries = [];
        this.qmh_index = 0;

        this.msg_map = {
                'welcome': this.msg_welcome,
                'login_token': this.msg_login_token,
                'logged_in': this.msg_logged_in,
                'error': this.msg_error,
                'error_login': this.msg_error_login,
                'error_login_accessKey': this.msg_error_login,
                'error_request': this.msg_error_request,
                'accessKey': this.msg_accessKey,
                'requests': this.msg_requests,
                'query_media_results': this.msg_query_media_results,
                'playing': this.msg_playing};
}

PijsMarietje.prototype.run = function() {
        this.setup_ui();
        this.setup_joyce();
};

PijsMarietje.prototype.setup_joyce = function() {
        var that = this;
        this.comet = new joyceCometClient(pijsmarietje_config.server);

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

PijsMarietje.prototype.msg_error = function(msg) {
        $.jGrowl("Error: " + msg['message']);
}

PijsMarietje.prototype.msg_playing = function(msg) {
        var that = this;
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

PijsMarietje.prototype.msg_login_token = function(msg) {
        this.login_token = msg['login_token'];
        this.on_login_token();
};

PijsMarietje.prototype.msg_accessKey = function(msg) {
        this.save_accessKey(this.username, msg['accessKey']);
};

PijsMarietje.prototype.msg_welcome = function(msg) {
        var that = this;
        if(this.waiting_for_welcome) {
                this.waiting_for_welcome = false;
                $('#welcome-dialog').dialog('close');
                this.focus_queryField();
                var tmp = this.get_accessKey();
                if(tmp != null) {
                        function _do_ak_login() {
                                that.do_accessKey_login(tmp[0], tmp[1]);
                        };
                        if(this.login_token == null) {
                                if(this.waiting_for_login_token)
                                        return;
                                this.after_login_token_cb = function() {
                                        _do_ak_login();
                                };
                                this.request_login_token();
                        } else
                                _do_ak_login();
                }
        }
};

PijsMarietje.prototype.msg_logged_in = function(msg) {
        if(this.waiting_for_logged_in) {
                this.waiting_for_logged_in = false;
                $('#loggingin-dialog').dialog('close');
                this.focus_queryField();
                if(this.logged_in)
                        return;
                this.logged_in = true;
                this.save_accessKey(this.username, msg['accessKey']);
                if(this.after_login_cb != null)
                        this.after_login_cb();
        }
};


PijsMarietje.prototype.msg_error_request = function(msg) {
        $.jGrowl('Request error: ' + msg['message']);
};

PijsMarietje.prototype.msg_error_login = function(msg) {
        if(this.waiting_for_logged_in) {
                this.waiting_for_logged_in = false;
                $('#loggingin-dialog').dialog('close');
                this.focus_queryField();
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

PijsMarietje.prototype.msg_query_media_results = function(msg) {
        var that = this;
        if(msg['token'] != this.qm_token)
                return;
        // Has the user already issues a new query?
        if(this.qm_has_delayed_query) {
                this.qm_initial_request();
                return;
        }
        if(this.qm_current_query == '')
                return;
        // If this is the first batch of results, we record the query
        // in the query history.
        if(this.qm_results_offset == 0)
                this.qmh_record(this.qm_current_query);
        var t = $('#resultsTable');
        $('.loading', t).remove();
        this.qm_results_offset += msg.results.length;
        for(var i = 0; i < msg.results.length; i++) {
                var m = msg.results[i];
                var tr = create_tr([m.artist, m.title]);
                $(tr).data('key', m.key);
                $('td:eq(0)',tr).addClass('artist');
                $('td:eq(1)',tr).addClass('title');
                $(tr).click(function() {
                        $('#queryField').val('');
                        that.check_queryField();
                        that.focus_queryField();
                        that.request_media($(this).data('key'));
                });
                t.append(tr);
        }
        if (msg.results.length != this.qm_results_requested) {
                this.qm_has_more_results = false;
                /* Add the fleuron */
                t.append($("<tr><td colspan='2' class='fleuron'>l</td></tr>"));
        }
        this.qm_request_outstanding = false;
        setTimeout(function() {
                that.on_scroll();
        },0);
};

PijsMarietje.prototype.refresh_resultsTable = function() {
        var that = this;
        $('#resultsTable').empty();
        if(this.qm_request_outstanding)
                // If there is already a query oustanding, we wait for it
                // and queue the new query.
                this.qm_has_delayed_query = true;
        else
                this.qm_initial_request();
};

PijsMarietje.prototype.qm_initial_request = function() {
        this.qm_has_more_results = true;
        this.qm_results_offset = 0;
        this.qm_request_outstanding = false;
        this.qm_has_delayed_query = false;
        this.qm_request_more_results();
};

PijsMarietje.prototype.refresh_requestsTable = function() {
        // When we hide the requestsToolbox, it is detached from the DOM.
        // If we do not do this, the .empty() call will clear the jQuery
        // data on the requestsToolbox and break the buttons.
        this.rtb_hide(true);
        $('#requestsTable').empty();
        this.fill_requestsTable();
};

PijsMarietje.prototype.qm_request_more_results = function() {
        var that = this;
        this.qm_request_outstanding = true;
        this.channel.send_message({type: 'query_media',
                                   query: this.qm_current_query,
                                   token: ++this.qm_token,
                                   skip: this.qm_results_offset,
                                   count: this.qm_results_requested})
        $('#resultsTable').append($(
                        '<tr><td colspan="2" class="loading"></td></tr>'));
};

PijsMarietje.prototype.request_media = function(key) {
        var that = this;
        if(!this.logged_in) {
                that.after_login_cb = function() {
                        that.request_media(key);
                };
                this.prepare_login();
                return;
        }
        this.channel.send_message({
                type: 'request',
                mediaKey: key});
};

PijsMarietje.prototype.fill_requestsTable = function() {
        var that = this;
        var t = $('#requestsTable');
        var start = (this.got_playing ? -1 : 0);
        var end = (this.got_requests ? this.requests.length : 0);
        var ctime = null;
        for(var i = start; i < end; i++) {
                var m = (i == -1 ? this.playing.media
                                :this.requests[i].media);
                var b = (i == -1 ? this.playing.byKey
                                : this.requests[i].byKey);
                if(!b)
                        b = 'marietje';
                txt_a = m.artist;
                txt_t = m.title;
                ctime = (i == -1 ? 0 : ctime + m.length);
                tr = create_tr([b, txt_a, txt_t,
                                (ctime == null ? '' : ctime)]);
                $(tr).data('offset', ctime);
                if(i == -1)
                        $(tr).data('key', null);
                else
                        $(tr).data('key', this.requests[i].key);
                $('td:eq(0)',tr).addClass('by');
                $('td:eq(1)',tr).addClass('artist');
                $('td:eq(2)',tr).addClass('title');
                $('td:eq(3)',tr).addClass('time');
                $(tr).hover(function(event) {
                        if($(this).data('key') == null
                                        && !that.rtb_over_playing) {
                                $('.up', that.rtb_el).hide();
                                $('.down', that.rtb_el).hide();
                                $('.del', that.rtb_el).hide();
                                $('.skip', that.rtb_el).show();
                                that.rtb_over_playing = true;
                        } else if ($(this).data('key') != null  &&
                                        that.rtb_over_playing) {
                                $('.up', that.rtb_el).show();
                                $('.down', that.rtb_el).show();
                                $('.del', that.rtb_el).show();
                                $('.skip', that.rtb_el).hide();
                                that.rtb_over_playing = false;
                        }
                        if(!that.rtb_visible) {
                                that.rtb_visible = true;
                                that.rtb_el.show();
                        }
                        /* We need to put the toolbox somewhere in the row,
                         * otherwise a mouseenter on the toolbox will not
                         * propogate to the tr. */
                        that.rtb_el.detach().prependTo($('.artist', this));
                        if(that.rtb_hideTimeout) {
                                clearTimeout(that.rtb_hideTimeout);
                                that.rtb_hideTimeout = null;
                        }
                        that.rtb_key = $(this).data('key');
                }, function() {
                        that.rtb_hide();
                });
                t.append(tr);
        }
        this.update_times();
};

PijsMarietje.prototype.get_accessKey = function() {
        if($.cookie('accessKey'))
                return [$.cookie('username'),
                        $.cookie('accessKey')];
        return null;
};

PijsMarietje.prototype.save_accessKey = function(username, accessKey) {
        $.cookie('username', username, { expires: 7 });
        $.cookie('accessKey', accessKey, { expires: 7 });
};

PijsMarietje.prototype.on_channel_ready = function() {
        // Create uploader
        this.uploader = new qq.FileUploader({
                element: $('#uploader')[0],
                action: this.channel.stream_url});

        // Request list of media and follow updates
        this.channel.send_messages([
                {'type': 'follow',
                 'which': ['playing', 'requests']}])
};

PijsMarietje.prototype.request_login_token = function() {
        if(this.waiting_for_login_token)
                return;
        this.channel.send_message({
                type: 'request_login_token' });
        this.waiting_for_login_token = true;
        $('#login-token-dialog').dialog('open');
};

PijsMarietje.prototype.prepare_login = function() {
        var that = this;
        if(this.waiting_for_login_token)
                return;
        if(this.login_token == null) {
                this.after_login_token_cb = function() {
                        $('#login-dialog').dialog('open');
                };
                this.request_login_token();
        } else
                $('#login-dialog').dialog('open');
};

PijsMarietje.prototype.on_login_token = function() {
        if(this.waiting_for_login_token) {
                this.waiting_for_login_token = false;
                $('#login-token-dialog').dialog('close');
                this.focus_queryField();
                if(this.after_login_token_cb != null)
                        this.after_login_token_cb();
        }
};

PijsMarietje.prototype.do_accessKey_login = function(username, accessKey) {
        var hash = md5(accessKey + this.login_token);
        this.waiting_for_logged_in = true;
        $('#loggingin-dialog').dialog('open');
        this.channel.send_message({
                'type': 'login_accessKey',
                'username': username,
                'hash': hash});
}

PijsMarietje.prototype.do_login = function(username, password) {
        var hash = md5(md5(password) + this.login_token);
        this.username = username;
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
                        that.mainTabShown = ui.index == 0;
                        if(ui.panel.id == "tUpload" && !that.logged_in) {
                                var tabs = $(this);
                                that.after_login_cb = function() {
                                        tabs.tabs('select', "tUpload");
                                };
                                that.prepare_login();
                                return false;
                        } else if (ui.panel.id == "tMain") {
                                that.focus_queryField();
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
                                that.focus_queryField();
                                that.do_login($('#username').val(),
                                                $('#password').val());
                        },
                        "Cancel": function() {
                                $(this).dialog("close");
                                that.focus_queryField();
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

        // Set up the main tables
        $('#queryField').keypress(function(e) {
                return that.on_queryField_keyPress(e);
        });
        $('#queryField').keydown(function(e) {
                return that.on_queryField_keyDown(e);
        });
        $('#resultsBar').hide();
        $('#tabsWrapper').scroll(function() {
                that.on_scroll();
        });

        // Button
        $('.up', that.rtb_el).button(
                        { icons: { primary: 'ui-icon-circle-arrow-n'},
                          text: false }).click(function(){
                that.channel.send_message({
                        'type': 'move_request',
                        'amount': -1,
                        'key': that.rtb_key
                });
        });
        $('.down', that.rtb_el).button(
                        { icons: { primary: 'ui-icon-circle-arrow-s'},
                          text: false }).click(function(){
                that.channel.send_message({
                        'type': 'move_request',
                        'amount': 1,
                        'key': that.rtb_key
                });
        });
        $('.del', that.rtb_el).button(
                        { icons: { primary: 'ui-icon-circle-close' },
                          text: false }).click(function(){
                that.channel.send_message({
                        'type': 'cancel_request',
                        'key': that.rtb_key
                });
        });
        $('.skip', that.rtb_el).button(
                        { icons: { primary: 'ui-icon-seek-next' },
                          text: false }).click(function(){
                that.channel.send_message({
                        'type': 'skip_playing'
                });
        }).hide();

        this.rtb_hide(true);
        that.focus_queryField();
}; 

PijsMarietje.prototype.rtb_hide = function(immediately) {
        var that = this;
        if(immediately) {
                that.rtb_el.detach().hide();
                that.rtb_visible = false;
                that.rtb_key = null;
                return;
        }
        this.rtb_hideTimeout = setTimeout(function() {
                that.rtb_hideTimeout = null;
                that.rtb_hide(true);
        }, 200);
};

PijsMarietje.prototype.focus_queryField = function() {
        setTimeout(function() {
                $('#queryField').focus();
        }, 0);
};

PijsMarietje.prototype.on_queryField_keyDown= function(e) {
        var that = this;
        if(e.keyCode == 38 || e.keyCode == 40) { // up or down

                this.qmh_index = e.keyCode == 38 ?
                        Math.max(0, this.qmh_index - 1) :
                        Math.min(this.qmh_entries.length, this.qmh_index + 1);
                $('#queryField').val(this.qmh_index == this.qmh_entries.length ?
                        '' : this.qmh_entries[this.qmh_index]);
        }
        setTimeout(function() {
                that.check_queryField();
        }, 0);
};

PijsMarietje.prototype.on_queryField_keyPress = function(e) {
        var that = this;
        if(e.which == 21) // C-u
                $('#queryField').val('');
        setTimeout(function() {
                that.check_queryField();
        }, 0);
};

PijsMarietje.prototype.check_queryField = function() {
        var that = this;
        var q = $('#queryField').val();
        if(!this.re_queryCheck.test(q)) {
                q = q.toLowerCase().replace(this.re_queryReplace, '');
                $('#queryField').val(q);
        }
        if(q == this.qm_current_query)
                return;
        this.qm_current_query = q;
        _cb = function() { that.up_scroll_semaphore(); };
        if(q == '' && this.qm_showing_results) {
                this.down_scroll_semaphore();
                this.down_scroll_semaphore();
                $('#resultsBar').hide('fast', _cb);
                $('#requestsBar').show('fast', _cb);
                this.qm_showing_results = false;
        } else if (q != '' && !this.qm_showing_results) {
                this.down_scroll_semaphore();
                this.down_scroll_semaphore();
                $('#resultsBar').show('fast', _cb);
                $('#requestsBar').hide('fast', _cb);
                this.qm_showing_results = true;
        }
        if(q == '')
                // Reset query history index
                this.qmh_index = this.qmh_entries.length;
        else
                this.refresh_resultsTable();
};

PijsMarietje.prototype.up_scroll_semaphore = function() {
        this.scroll_semaphore++;
        if(this.scroll_semaphore == 0)
                this.on_scroll();
};

PijsMarietje.prototype.down_scroll_semaphore = function() {
        this.scroll_semaphore--;
};

PijsMarietje.prototype.on_scroll = function() {
        if(!this.mainTabShown || this.scroll_semaphore != 0
                        || !this.qm_showing_results)
                return;
        var that = this;
        var diff = $('#tMain').height() -
                   $('#tabsWrapper').scrollTop() -
                   $('#tabsWrapper').height();
        if(diff <= 0) {
                if(this.qm_has_more_results && !this.qm_request_outstanding)
                        this.qm_request_more_results();
        }
};

PijsMarietje.prototype.qmh_record = function(query) {
        // Add query to the history if it is not the last query already
        // and this query was not executed because we were looking back
        // in the history.
        if(this.qmh_entries[this.qmh_entries.length - 1] != query &&
                        (this.qmh_index == this.qmh_entries.length ||
                         this.qmh_entries[this.qmh_index] != query))
                this.qmh_entries.push(query);
        // Reset the history index if we were not browsing history
        if(this.qmh_index < this.qmh_entries.length &&
                        this.qmh_entries[this.qmh_index] != query)
                this.qmh_index = this.qmh_entries.length - 1;
};

$(document).ready(function(){
        pijsmarietje = new PijsMarietje();
        pijsmarietje.run();
});

})();
