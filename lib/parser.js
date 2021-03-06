'use strict'

var parser = exports
var esprima = require('esprima')
var node_path = require('path')
var fs = require('fs')
var util = require('util')
var unique = require('array-unique')
var tools = require('./tools')


// Parses a file and get its dependencies and code
// @param {String} content
// @param {String} path
// @param {Object} options
// @param {function()} callback
parser.parse = function (path, content, options, callback) {
  parser._lex_js(content, function (err, ast) {
    var message
    var parsed

    if (err) {
      parsed = tools.fixes_line_code(err.message)
      message = 'Error parsing "' + path + '": ' + parsed.message

      if (parsed.line) {
        message += '\n\n' + tools.print_code(content, {
          line: parsed.line
        })
      }

      return callback({
        code: 'ERROR_PARSE_JS',
        message: message,
        data: {
          path: path,
          error: err
        }
      })
    }

    var dependencies = {
      normal: [],
      resolve: [],
      async: []
    }

    try {
      parser._parse_dependencies(ast, dependencies, options)
    } catch(e) {
      parsed = tools.fixes_line_code(e.message)
      message = 'Error parsing dependencies: '
        + parsed.message
        + '\n\n'
        + tools.print_code(content, e.loc)

      return callback({
        code: 'WRONG_USAGE_REQUIRE',
        message: message,
        data: {
          path: path,
          error: e
        }
      })
    }

    if (options.comment_require) {
      parser._parse_comments(ast, dependencies, options)
    }

    callback(null, {
      // code: content,
      path: path,
      require: unique(dependencies.normal),
      resolve: unique(dependencies.resolve),
      async: unique(dependencies.async)
    })
  })
}


// Parses the content of a javascript to AST
parser._lex_js = function (content, callback) {
  content = tools.silly_wrap(content)

  var ast
  try {
    ast = esprima.parse(content, {
      loc: true,
      comment: true
    })
  } catch(e) {
    return callback(e)
  }

  callback(null, ast)
}


// Parses AST and returns the dependencies
parser._parse_dependencies = function (node, dependencies, options) {
  // Only arrays or objects has child node, or is a sub AST.
  if (!node || Object(node) !== node) {
    return
  }

  parser._check_dependency_node(node, function (node) {
    return node.type === 'CallExpression'
      && node.callee.type === 'Identifier'
      && node.callee.name === 'require'

  }, dependencies.normal, options, true)

  || options.require_resolve && parser._check_dependency_node(node, function (node) {
    return node.type === 'CallExpression'
      && node.callee.type === 'MemberExpression'
      && node.callee.object.name === 'require'
      && node.callee.property.name === 'resolve'

  }, dependencies.resolve, options, true)

  || options.require_async && parser._check_dependency_node(node, function (node) {
    return node.type === 'CallExpression'
      && node.callee.type === 'MemberExpression'
      && node.callee.object.name === 'require'
      && node.callee.property.name === 'async'
  }, dependencies.async, options, false)

  if (util.isArray(node)) {
    node.forEach(function (sub) {
      parser._parse_dependencies(sub, dependencies, options)
    })

  } else {
    var key
    for (key in node) {
      parser._parse_dependencies(node[key], dependencies, options)
    }
  }
}


parser._check_dependency_node = function (node, condition, deps_array, options, check_if_length_exceeded) {
  if (!condition(node)) {
    return
  }

  var args = node.arguments
  var loc = node.callee.loc.start
  var check_length = options.check_require_length

  if (args.length === 0) {
    tools.throw(check_length, 'Method `require` accepts one and only one parameter.', loc)
  }

  if (check_if_length_exceeded && args.length > 1) {
    tools.throw(check_length, 'Method `require` should not contains more than one parameters', loc)
  }

  var arg1 = args[0]
  if (!arg1) {
    return
  }
  
  if (arg1.type !== 'Literal') {
    tools.throw(!options.allow_non_literal_require, 'Method `require` only accepts a string literal.', arg1.loc.start)

  } else {
    deps_array.push(arg1.value)
  }
}


var REGEX_LEFT_PARENTHESIS_STRING = '\\s*\\(\\s*([\'"])([A-Za-z0-9_\\/\\-\\.]+)\\1\\s*'
var REGEX_PARENTHESIS_STRING      = REGEX_LEFT_PARENTHESIS_STRING + '\\)'

var REGEX_REQUIRE         = 
  new RegExp('@require'           + REGEX_PARENTHESIS_STRING, 'g')

var REGEX_REQUIRE_RESOLVE = 
  new RegExp('@require\\.resolve' + REGEX_PARENTHESIS_STRING, 'g')

var REGEX_REQUIRE_ASYNC = 
  new RegExp('@require\\.async'   + REGEX_LEFT_PARENTHESIS_STRING, 'g')

// Parses `@require`, `@require.resolve`, `@require.async` in comments
parser._parse_comments = function (ast, dependencies, options) {
  var comments = ast.comments
  if (!comments) {
    return
  }

  comments.forEach(function (comment) {
    parser._parse_by_regex(comment.value, REGEX_REQUIRE, dependencies.normal)

    if (options.require_resolve) {
      parser._parse_by_regex(comment.value, REGEX_REQUIRE_RESOLVE, dependencies.resolve)
    }

    if (options.require_async) {
      parser._parse_by_regex(comment.value, REGEX_REQUIRE_ASYNC, dependencies.async)
    }
  })
}


// @param {string} content
// @param {RegExp} regex
// @param {*Array} matches
parser._parse_by_regex = function (content, regex, matches) {
  var match
  while(match = regex.exec(content)){
    matches.push(match[2])
  }
}
