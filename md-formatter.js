#!/usr/bin/env node
var unified = require('unified');
var createStream = require('unified-stream');
var parse = require('remark-parse');
var toc = require('remark-toc');
var stringify = require('remark-stringify');
var frontmatter = require('remark-frontmatter');

var processor = unified()
    .use(parse)
    .use(toc)

    .use(stringify, {
        bullet: '*',
        setext: true,
        looseTable: true,
        closeAtx: true,
        // fence: '~',
        // fences: true,
        // incrementListMarker: false
    })
    .use(frontmatter, ['yaml', 'toml']);

process.stdin.pipe(createStream(processor)).pipe(process.stdout);
