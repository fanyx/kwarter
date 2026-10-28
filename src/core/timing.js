"use strict";

var pendingTimers = [];

function defer(fn) {
    var timer = new QTimer();
    pendingTimers.push(timer);
    timer.singleShot = true;
    timer.interval = 0;
    timer.timeout.connect(function () {
        var index = pendingTimers.indexOf(timer);
        if (index >= 0) pendingTimers.splice(index, 1);
        fn();
    });
    timer.start(0);
}

module.exports = {
    defer,
};
