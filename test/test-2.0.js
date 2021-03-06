/* eslint-env browser, mocha */

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

var _ = require('lodash-compat');
var assert = require('assert');
var JsonRefs = require('json-refs');
var swaggerApi = require('..');
var pathLoader = require('path-loader');
var types = require('../lib/types');
var YAML = require('js-yaml');

var implementation = require('../lib/versions/2.0');
var swaggerDocPath = 'http://localhost:44444/swagger.yaml';

function getOperationCount (path) {
  var count = 0;

  _.each(path, function (operation, method) {
    if (implementation.supportedHttpMethods.indexOf(method) > -1) {
      count += 1;
    }
  });

  return count;
}

describe('swagger-core-api (Swagger 2.0)', function () {
  var resolvedRefs;
  var resolvedSwaggerDoc;
  var swagger;
  var swaggerDoc;

  before(function (done) {
    pathLoader
      .load(swaggerDocPath)
      .then(YAML.safeLoad)
      .then(function (json) {
        swaggerDoc = json;

        return json;
      })
      .then(function (json) {
        return new Promise(function (resolve, reject) {
          JsonRefs.resolveRefs(json, function (err, resolved, metadata) {
            if (err) {
              reject(err);
            } else {
              resolvedRefs = metadata;
              resolvedSwaggerDoc = resolved;

              resolve();
            }
          });
        });
      })
      .then(function () {
        return swaggerApi.create({
          definition: swaggerDoc
        })
          .then(function (obj) {
            swagger = obj;
          });
      })
      .then(done, done);
  });

  describe('swagger-core-api#create', function () {
    function validateCreateSwaggerApi (options) {
      return function (theApi) {
        assert.ok(theApi instanceof types.SwaggerApi);
        assert.deepEqual(swaggerDoc, theApi.definition);
        assert.equal(implementation.documentation, theApi.documentation);
        assert.deepEqual(options, theApi.options);
        assert.equal(implementation.version, theApi.version);
        assert.deepEqual(resolvedRefs, theApi.references);
        assert.deepEqual(resolvedSwaggerDoc, theApi.resolved);

        // Validate the merging of the Swagger definition properties and the SwaggerApi properties
        _.forEach(swaggerDoc, function (val, key) {
          assert.deepEqual(val, theApi[key]);
        });

        // Validate the operations (Simple tests for now, deeper testing is below)
        assert.ok(_.isArray(theApi.operationObjects));
        assert.ok(theApi.operationObjects.length > 0);

        _.each(theApi.operationObjects, function (operation) {
          assert.ok(operation instanceof types.Operation);

          // Validate the parameters (Simple tests for now, deeper testing is below)
          _.each(operation.parameterObjects, function (parameter) {
            assert.ok(parameter instanceof types.Parameter);
          });
        });
      };
    }

    function validateCreateSwaggerApiCallback (options, done) {
      return function (err, theApi) {
        assert.ok(_.isUndefined(err));

        validateCreateSwaggerApi(options)(theApi);

        done();
      };
    }

    describe('promises', function () {
      it('should handle definition object', function (done) {
        var options = {
          definition: swaggerDoc
        };

        swaggerApi.create(options)
          .then(validateCreateSwaggerApi(options))
          .then(done, done);
      });

      it('should handle definition file location', function (done) {
        var options = {
          definition: swaggerDocPath
        };

        swaggerApi.create(options)
          .then(validateCreateSwaggerApi(options))
          .then(done, done);
      });

      // TODO: Add test for definition file URL (remote)
    });

    describe('callbacks', function () {
      it('should handle definition object', function (done) {
        var options = {
          definition: swaggerDoc
        };

        swaggerApi.create(options, validateCreateSwaggerApiCallback(options, done))
          .catch(done);
      });

      it('should handle definition file location', function (done) {
        var options = {
          definition: swaggerDocPath
        };

        swaggerApi.create(options, validateCreateSwaggerApiCallback(options, done))
          .catch(done);
      });

      // TODO: Add test for definition file URL (remote)
    });
  });

  describe('Operation', function () {
    it('should handle composite parameters', function () {
      var method = 'get';
      var path = '/pet/{petId}';
      var operation = swagger.getOperation(path, method);
      var pathDef = swagger.resolved.paths[path];

      assert.equal(path, operation.path);
      assert.equal(method, operation.method);
      assert.equal('#/paths/~1pet~1{petId}/get', operation.ptr);

      _.each(operation.definition, function (val, key) {
        if (key === 'parameters') {
          assert.deepEqual([
            pathDef.parameters[0]
          ], val);
        } else if (key === 'security') {
          assert.deepEqual([
            {
              'petstore_auth': [
                'read:pets',
                'write:pets'
              ]
            }
          ], val);
        } else {
          assert.deepEqual(pathDef[method][key], val);
        }
      });

      assert.equal(1, operation.parameterObjects.length);

      _.each(operation.parameterObjects, function (parameter) {
        assert.ok(parameter instanceof types.Parameter);
      });
    });

    it('should handle explicit parameters', function () {
      var method = 'post';
      var path = '/pet/{petId}/uploadImage';
      var operation = swagger.getOperation(path, method);
      var pathDef = swagger.resolved.paths[path];

      assert.equal(path, operation.path);
      assert.equal(method, operation.method);
      assert.equal('#/paths/~1pet~1{petId}~1uploadImage/post', operation.ptr);

      _.each(operation.definition, function (val, key) {
        if (key === 'security') {
          assert.deepEqual([
            {
              'petstore_auth': [
                'read:pets',
                'write:pets'
              ]
            }
          ], val);
        } else {
          assert.deepEqual(pathDef[method][key], val);
        }
      });

      _.each(operation.parameterObjects, function (parameter) {
        assert.ok(parameter instanceof types.Parameter);
      });
    });

    it('should handle composite security', function () {
      assert.deepEqual([
        {
          'petstore_auth': [
            'read:pets',
            'write:pets'
          ]
        }
      ], swagger.getOperation('/pet/{petId}', 'get').security);
    });

    it('should handle explicit parameters', function () {
      assert.deepEqual([
        {
          'api_key': []
        }
      ], swagger.getOperation('/user/{username}', 'get').security);
    });
  });

  describe('Parameter', function () {
    it('should have proper structure', function () {
      var path = '/pet/{petId}';
      var pathDef = swagger.resolved.paths[path];

      _.each(swagger.getOperation(path, 'post').getParameters(), function (parameter, index) {
        var ptr = '#/paths/~1pet~1{petId}/';
        var def;

        if (index === 0) {
          def = pathDef.parameters[0];
          ptr += 'parameters/0';
        } else {
          def = pathDef.post.parameters[index - 1];
          ptr += 'post/parameters/' + (index - 1);
        }

        assert.equal(ptr, parameter.ptr);
        assert.deepEqual(def, parameter.definition);
      });
    });

    describe('#getParameters', function () {
      it('should return all parameters', function () {

      });
    });
  });

  describe('SwaggerApi', function () {
    describe('#getOperations', function () {
      it('should return return all operations', function () {
        var operations = swagger.getOperations();

        assert.equal(_.reduce(swagger.definition.paths, function (count, path) {
          count += getOperationCount(path);

          return count;
        }, 0), operations.length);

        // Validate the operations
      });

      it('should return return all operations for the given path', function () {
        var operations = swagger.getOperations('/pet/{petId}');

        assert.ok(swagger.getOperations().length > operations.length);
        assert.equal(getOperationCount(swagger.definition.paths['/pet/{petId}']), operations.length);
      });

      it('should return return no operations for a missing path', function () {
        assert.equal(0, swagger.getOperations('/some/fake/path').length);
      });
    });

    describe('#getOperation', function () {
      it('should return the expected operation', function () {
        var operation = swagger.getOperation('/pet/{petId}', 'get');

        assert.ok(!_.isUndefined(operation));
      });

      it('should return no operation for missing path', function () {
        assert.ok(_.isUndefined(swagger.getOperation('/petz/{petId}', 'get')));
      });

      it('should return no operation for missing method', function () {
        assert.ok(_.isUndefined(swagger.getOperation('/pet/{petId}', 'head')));
      });
    });
  });
});
