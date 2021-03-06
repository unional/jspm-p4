var path = require('path');
var fs = require('fs');

var appRoot = 'src/';
var pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

module.exports = {
    root: appRoot,
    source: appRoot + '**/*',
    output: 'dist/',
    doc:'./doc',
    packageName: pkg.name
};
