/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Apigee Corporation
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

'use strict';

var browserify = require('browserify');
var concat = require('gulp-concat');
var del = require('del');
var eslint = require('gulp-eslint');
var exposify = require('exposify');
var fs = require('fs');
var gulp = require('gulp');
var istanbul = require('gulp-istanbul');
var jsdoc2Md = require('gulp-jsdoc-to-markdown');
var mocha = require('gulp-mocha');
var mochaPhantomJS = require('gulp-mocha-phantomjs');
var runSequence = require('run-sequence');
var source = require('vinyl-source-stream');
var testHelpers = require('./test/helpers');

var runningAllTests = process.argv.indexOf('test-browser') === -1 && process.argv.indexOf('test-node') === -1;

// Load promises polyfill if necessary
if (typeof Promise === 'undefined') {
  require('native-promise-only');
}

function displayCoverageReport (display) {
  if (display) {
    gulp.src([])
      .pipe(istanbul.writeReports());
  }
}

gulp.task('browserify', function () {
  function browserifyBuild (isStandalone, useDebug) {
    return new Promise(function (resolve, reject) {
      var b = browserify('./index.js', {
        debug: useDebug,
        standalone: 'SwaggerApi'
      });

      if (!useDebug) {
        b.transform({global: true}, 'uglifyify');
      }

      if (!isStandalone) {
        // Expose Bower modules so they can be required
        exposify.config = {
          'json-refs': 'JsonRefs',
          'js-yaml': 'jsyaml',
          'lodash-compat': '_',
          'path-loader': 'PathLoader'
        };

        b.transform('exposify');
      }

      b.transform('brfs')
        .bundle()
        .pipe(source('swagger-core-api' + (isStandalone ? '-standalone' : '') + (!useDebug ? '-min' : '') + '.js'))
        .pipe(gulp.dest('browser/'))
        .on('error', reject)
        .on('end', resolve);
    });
  }

  return Promise.resolve()
    // Standalone build with source maps and complete source
    .then(browserifyBuild(true, true))
    // Standalone build minified and without source maps
    .then(browserifyBuild(true, false))
    // Bower build with source maps and complete source
    .then(browserifyBuild(false, true))
    // Bower build minified and without source maps
    .then(browserifyBuild(false, false));
});

gulp.task('clean', function (done) {
  del([
    'bower_components',
    'coverage'
  ], done);
});

gulp.task('lint', function () {
  return gulp.src([
    'index.js',
    'lib/**/*.js',
    'test/**/*.js',
    '!test/browser/**/*.js',
    'gulpfile.js'
  ])
    .pipe(eslint())
    .pipe(eslint.format('stylish'))
    .pipe(eslint.failAfterError());
});

gulp.task('test-node', function () {
  var httpServer;

  function cleanUp () {
    try {
      httpServer.close();
    } catch (err2) {
      if (err2.message.indexOf('Not running') === -1) {
        console.error(err2.stack);
      }
    }
  }

  return Promise.resolve()
    .then(function () {
      httpServer = testHelpers.createServer(require('http')).listen(44444);
    })
    .then(function () {
      return new Promise(function (resolve, reject) {
        gulp.src([
          'index.js',
          'lib/**/*.js'
        ])
          .pipe(istanbul({includeUntested: true}))
          .pipe(istanbul.hookRequire()) // Force `require` to return covered files
          .on('finish', function () {
            gulp.src([
              'test/**/test-*.js',
              '!test/browser/test-*.js'
            ])
              .pipe(mocha({reporter: 'spec'}))
              .on('error', function (err) {
                cleanUp();

                reject(err);
              })
              .on('end', function () {
                cleanUp();
                displayCoverageReport(!runningAllTests);

                resolve();
              });
          });
      });
    });
});

gulp.task('test-browser', ['browserify'], function () {
  var basePath = './test/browser/';
  var httpServer;

  function cleanUp () {
    // Clean up just in case
    del.sync([
      basePath + 'swagger-core-api.js',
      basePath + 'swagger-core-api-standalone.js',
      basePath + 'test-browser.js'
    ]);

    if (httpServer) {
      httpServer.close();
    }
  }

  return Promise.resolve()
    .then(cleanUp)
    .then(function () {
      // Copy the browser build of json-refs to the test directory
      fs.createReadStream('./browser/swagger-core-api.js')
        .pipe(fs.createWriteStream(basePath + 'swagger-core-api.js'));
      fs.createReadStream('./browser/swagger-core-api-standalone.js')
        .pipe(fs.createWriteStream(basePath + 'swagger-core-api-standalone.js'));

      return new Promise(function (resolve, reject) {
        var b = browserify([
          './test/test-module.js',
          './test/test-2.0.js'
        ], {
          debug: true
        });

        b.transform('brfs')
          .bundle()
          .pipe(source('test-browser.js'))
          .pipe(gulp.dest(basePath))
          .on('error', function (err) {
            reject(err);
          })
          .on('end', function () {
            resolve();
          });
      });
    })
    .then(function () {
      httpServer = testHelpers.createServer(require('http')).listen(44444);
    })
    .then(function () {
      return new Promise(function (resolve, reject) {
        gulp
          .src([
            basePath + 'test-bower.html',
            basePath + 'test-standalone.html'
          ])
          .pipe(mochaPhantomJS({
            phantomjs: {
              localToRemoteUrlAccessEnabled: true,
              webSecurityEnabled: false,
              ignoreResourceErrors: true
            },
            timeout: 5000
          }))
          .on('error', function (err) {
            cleanUp();
            displayCoverageReport(runningAllTests);

            reject(err);
          })
          .on('finish', function () {
            cleanUp();
            displayCoverageReport(runningAllTests);

            resolve();
          });
      });
    });
});

gulp.task('docs', function () {
  return gulp.src([
    './index.js',
    'lib/*.js'
  ])
    .pipe(concat('API.md'))
    .pipe(jsdoc2Md())
    .pipe(gulp.dest('docs'));
});

gulp.task('test', function (cb) {
  runSequence('test-node', 'test-browser', cb);
});

gulp.task('default', function (cb) {
  runSequence('lint', 'test', 'docs', cb);
});
