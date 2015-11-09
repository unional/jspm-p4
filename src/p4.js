var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var crypto = require('crypto');
var fs = require('graceful-fs');
var ncp = require('ncp');
var exec = require('child_process').exec;
var semver = require('semver');
var semverRegex = require('semver-regex');
var path = require('path');
var rimraf = require('rimraf');
var nodeConversion = require('./node-conversion.js');
// var P4rc = require('./p4rc.js');

var isWindows = process.platform.match(/^win/);

function clone(a) {
    var b = {};
    for (var p in a) {
        if (a[p] instanceof Array)
        b[p] = [].concat(a[p]);
        else if (typeof a[p] == 'object')
        b[p] = clone(a[p]);
        else
        b[p] = a[p];
    }
    return b;
}

var defaultConfig = {
    // registryPath: "../.."
};

/**
* Create a Perforce registry
* @param {object} options Options from jspm (config?). Can contain any other registry-specific config.
* @param {string} options.tmpDir Path to a folder the registry can use to store temporary files. This folder persists and is shared between installs.
* @param {string} options.versionString Represents the minor and major version of the registry package, which is used in the caching hash of packages. This can be altered and written to the instance allowing for custom registry cache invalidation - `this.versionString = options.versionString + '.53'``.
* @param {object} ui      Accessing the ui (console)
*/
var P4Registry = module.exports = function P4Registry(options, ui) {
    this.ui = ui;
    this.options = options;
    this.execOptions = {
        cwd: options.registryPath,
        timeout: options.timeout * 1000,
        killSignal: 'SIGKILL'
    };
};

P4Registry.configure = function configure(config, ui) {
    return Promise.resolve()
    .then(function() {
        return ui.input('p4 local registry path', config.registryPath);
    })
    .then(function(registryPath) {
        config.registryPath = registryPath;
        return ui.input('p4 local registry client name (P4CLIENT)', config.workspace);
    })
    .then(function (workspace) {
        config.workspace = workspace;
        return config;
    });
};

P4Registry.packageFormat = /^@[^\/]+\/[^\/]+|^[^@\/][^\/]+/;

P4Registry.prototype = {
    lookup: function(packageName) {
        var root = path.resolve(this.options.registryPath);
        var packagePath = path.resolve(root, packageName);
        var latestKey = 'latest';
        var p4set = true;
        var me = this;
        // if (packageName.split('/').length !== 1) {
        //     throw new Error("Perforce packages currently only support flat repo (like npm@3+)");
        // }

        return Promise.resolve()
        .then(me._saveExistingWorkspace.bind(me))
        .then(function() {
            var cachePath = path.resolve(me.options.tmpDir, packageName + '.json')
            // console.log(cachePath);
            return asp(fs.readFile)(cachePath);
        })
        .then(function(lookupJSON) {
            // console.log(lookupJSON);
            lookupCache = JSON.parse(lookupJSON.toString());
            // console.log(lookupCache);
        })
        .catch(function(e) {
            if (e.code === 'ENOENT' || e instanceof SyntaxError) {
                return;
            }
            throw e;
        })
        .then(me._overrideWorkspace.bind(me))
        .then(function() {
            // console.log('before p4 labels');
            // load labels from p4
            return asp(exec)('p4 labels ...', me.execOptions)
            .then(function(stdout, stderr) {
                if(stderr) {
                    throw stderr;
                }

                var lines = stdout.split('\n');
                var versions = {};
                for (var i = 0, len = lines.length; i < len; i++) {
                    var line = lines[i];
                    var version = semverRegex().exec(line);
                    if (version) {
                        versions[version] = {
                            hash: crypto.createHash('sha1').update(packageName + line).digest('hex')
                        }
                    }
                }

                return { versions: versions };
            })
            .catch(function(err) {
                if (typeof err === 'string') {
                    err = new Error(err);
                    err.hideStack = true;
                }
                err.retriable = true;
                throw err;
            });
        })
        .then(function(response) {
            return me._restoreWorkspace().then(function() {
                // todo save lookupCache
                return response;
            });
        });
    },
    download: function(packageName, version, hash, meta, dir) {
        // console.log('start download');
        var root = path.resolve(this.options.registryPath);
        var packagePath = path.resolve(root, packageName);
        var me = this;
        return me._saveExistingWorkspace()
        .then(me._overrideWorkspace.bind(me))
        .then(function() {
            // sync root to get new modules.
            return asp(exec)('p4 sync ' + root + "/...", me.execOptions)
            .then(function() {
                return asp(exec)('p4 sync ' + packagePath + '@' + version, me.execOptions)
                .then(function() {
                    return asp(exec)(isWindows? 'attrib -R /S ' + packagePath: 'chmod -R +w .')
                    .then(function() {
                        return asp(ncp)(packagePath, dir, me.execOptions);
                    });
                });
            });
        })
        .then(me._restoreWorkspace.bind(me))
        .then(function() {
            var filepath = path.resolve(packagePath, 'package.json');
            // console.log(filepath);
            return asp(fs.readFile)(filepath).
            then(function(pjson) {
                pjson = JSON.parse(pjson.toString());
                // console.log(pjson);
                return pjson;
            })
        });
    },
    _saveExistingWorkspace: function() {
        var me = this;
        return asp(exec)('p4 set P4CLIENT', this.execOptions)
        .then(function(stdout, stderr) {
            if (stderr) {
                throw stderr;
            }

            // https://regex101.com/r/oD5jW3/1
            p4set = /( \(set\)$){0,1}/g.test(stdout);
            if (!p4set) {
                throw new Error('Currently do not support env/set of P4CLIENT.')
            }
            // https://regex101.com/r/zA1wJ9/1
            var matches = stdout.match(/=([^ ]*)/);

            // console.log(stdout);
            me.existingWorkspace = matches[1];
        });
    },
    _overrideWorkspace: function() {
        // console.log('override', this.existingWorkspace, this.options.workspace);
        if (this.existingWorkspace != this.options.workspace) {
            return asp(exec)('p4 set P4CLIENT=' + this.options.workspace, this.execOptions);
        }
    },
    _restoreWorkspace: function() {
        if (this.existingWorkspace != this.options.workspace) {
            return asp(exec)('p4 set P4CLIENT=' + this.existingWorkspace, this.execOptions)
        }
        else {
            return Promise.resolve();
        }
    }
    // parse: function parse(name) {
    //     var parts = name.split('/');
    //     if (parts.length !== 2) {
    //         throw new Error("Perforce packages must be organized in the form of `owner(team)/repo`.");
    //     }
    //
    //     return {
    //         package: parts[0],
    //         path: parts.splice(1).join('/')
    //     };
    // },
    // updateRegistry: function updateRegistry() {
    //     if (this.updatePromise_)
    //     return Promise.resolve(this.updatePromise_);
    //
    //     var ui = this.ui;
    //     var registryPath = this.registryPath;
    //     var remoteString = this.repo;
    //     var execOptions = this.execOptions;
    //     var self = this;
    //
    //     return this.updatePromise_ = asp(exec)('git remote show origin -n', execOptions)
    //     .then(function(output) {
    //         output = output.toString();
    //
    //         var curRepoMatch = output.match(/Fetch URL: ([^\n]+)/m);
    //
    //         if (!curRepoMatch || curRepoMatch[1] != self.repo)
    //         return self.createRegistry();
    //
    //         // if the registry does exist, update it
    //         ui.log('info', 'Updating registry cache...');
    //         return asp(exec)('git fetch --all && git reset --hard origin/master', execOptions)
    //         .then(function(stdout, stderr) {
    //             if (stderr)
    //             throw stderr;
    //         })
    //         .catch(function(err) {
    //             if (typeof err == 'string') {
    //                 err = new Error(err);
    //                 err.hideStack = true;
    //             }
    //             err.retriable = true;
    //             throw err;
    //         });
    //     }, function(err) {
    //         err = err.toString();
    //
    //         // if the registry does not exist, do a git clone
    //         if (err.indexOf('Not a git repo') != -1)
    //         return self.createRegistry();
    //     })
    //     .then(function() {
    //         return asp(fs.readFile)(path.resolve(registryPath, 'registry.json'))
    //         .then(function(pjson) {
    //             try {
    //                 return JSON.parse(pjson);
    //             }
    //             catch(e) {
    //                 return {};
    //             }
    //         }, function(err) {
    //             if (err.code === 'ENOENT')
    //             return {};
    //             ui.log('warn', 'Registry file is invalid.');
    //         });
    //     })
    //     .then(function(json) {
    //         return json;
    //     });
    // }
};
