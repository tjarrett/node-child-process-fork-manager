const child = require('child_process')
    , merge = require('merge')
    , os = require('os')
    , winston = require('winston')

/**
 * Class for managing forks. This class is intended to be used with scripts that come alive, do their thing,
 * and then die.
 *
 * Usage Example:
 *
 * var m = new child_process_fork_manager({maxForks: 4});
 *
 *  //Example with callback
 * for (var i=0; i<8; i++) {
 *    setTimeout(function(){
 *       m.fork(__dirname + "/hi-and-bye.js", function(err, childProcess){
 *          console.log("Just received notice that child process " + childProcess.pid + " was opened!");
 *      });
 *
 *  }, (Math.floor(Math.random() * 3) + 1)*1000);
 * }
 *
 * //Example with promise
 * for (var i=0; i<8; i++) {
 * setTimeout(function(){
 *      m.fork(__dirname + "/hi-and-bye.js").then(childProcess => {
 *          console.log("Just received notice via a PROMISE that child process " + childProcess.pid + " was opened!");
 *      });
 *
 *  }, (Math.floor(Math.random() * 3) + 1)*1000);
 * }
 */
class ChildProcessForkManager {
    /**
     * Constructor that takes a settings object as input. Right now the only settings is "maxForks". If not
     * provided, maxForks will be equal to the number of CPU cores.
     *
     *
     * @param settings (optional)
     */
    constructor(settings) {
        var defaults = {
            maxForks: (os.cpus().length) - 1
        }

        this._settings = merge(defaults, settings);
        this._queuedForks = [];
        this._forks = [];

        winston.level = ((process.env.LOG_LEVEL) ? process.env.LOG_LEVEL : 'warn');

    }

    /**
     * Used only for debugging -- increments the debug port
     * @private
     */
    _updateDebugPort() {
        var debug = typeof v8debug === 'object';
        if (debug) {
            //Find the base debugger port
            var regex = /^--debug(?:-brk)?=([0-9]+)$/i;
            var debugIndex = process.execArgv.findIndex((element, index, array)=> {
                return element.match(regex)
            });
            var debugValue = process.execArgv[debugIndex];

            var matches = regex.exec(debugValue);
            var port = matches[1];
            port = parseInt(port);
            port++;

            process.execArgv.splice(debugIndex, 1);

            process.execArgv.push('--debug=' + port);
        }

    }

    /**
     * When a childProcess ends, this method is called
     *
     * @param childProcess
     * @private
     */
    _exitHandler(childProcess) {
        winston.log('debug', 'childProcess with pid just exited', childProcess.pid)
        var index = this._forks.indexOf(childProcess);
        this._forks.splice(index, 1);
        winston.log("debug", "Forks open ", this._forks.length);
        this._run();

    }

    /**
     * Actually handles the running of the forks
     * @private
     */
    _run() {
        winston.log('debug', 'Run called and there are ' + this._queuedForks.length + ' in the queue.');
        if (this._queuedForks.length == 0) {
            winston.log('debug', 'Queue is empty so nothing to do...');
            return;
        }

        if (this._forks.length <= this._settings.maxForks) {
            var f = this._queuedForks.shift();

            this._updateDebugPort();

            var childProcess = require('child_process').fork(f.modulePath, f.args, {});
            this._forks.push(childProcess)

            winston.log('debug', "Starting child process with pid", childProcess.pid)
            childProcess.on('exit', (code, signal) => {
                this._exitHandler(childProcess);
            });

            childProcess.on('error', (error) => {
                winston.log('error', 'ERROR: ', error);
                this._exitHandler(childProcess);

                if (typeof f.callback == 'function') {
                    f.callback(error, childProcess);
                }

                f.promise.reject(error);

            });

            winston.log('debug', "Count forks open ", this._forks.length);

            if (typeof f.callback == 'function') {
                f.callback(null, childProcess);
            }

            f.promise.resolve(childProcess);

        } else {
            winston.log('debug', 'Whoops we have ' + this._forks.length + ' open so not running this one right now...');

        }

    }

    /**
     * For anything that you can fork with child_process.fork(). This class will put it in the queue to be forked.
     * It can be used as a promise or with a callback. See class comment for usage examples.
     *
     * @see https://nodejs.org/api/child_process.html#child_process_child_process_fork_modulepath_args_options
     * @see https://nodejs.org/api/child_process.html#child_process_child_process
     *
     * @param modulePath        The path to the module
     * @param args              (Optional) Args array
     * @param options           (Optional) Additional options
     * @param callback          (Optional) Callback to be called. Parameters: err and the ChildProcess
     *
     * @return Promise
     */
    fork(modulePath) {
        var usePromise = false;

        if (arguments.length == 1 || (arguments.length > 1 && typeof arguments[arguments.length - 1] != 'function')) {
            usePromise = true;
        }

        var args = ((arguments.length >= 2 && typeof arguments[1] != 'function') ? arguments[1] : null);
        var options = ((arguments.length >= 3 && typeof arguments[2] != 'function') ? arguments[2] : null);
        var callback = ((usePromise) ? null : arguments[arguments.length - 1]);

        var promiseResolveReject = {};
        var promise = new Promise((resolve, reject) => {
            promiseResolveReject = {resolve: resolve, reject: reject};
        });

        this._queuedForks.push({
            modulePath: modulePath,
            args: args,
            options: options,
            callback: callback,
            promise: promiseResolveReject
        });

        this._run();

        return promise;

    }

}

module.exports = ChildProcessForkManager;