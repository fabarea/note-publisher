#!/usr/bin/env node
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const fm = require('front-matter');
const vfile = require('to-vfile');
const { prompt } = require('prompts');
const pipe = require('./pipe');
const unified = require('unified');
const parse = require('remark-parse');
const stringify = require('remark-stringify');
const frontmatter = require('remark-frontmatter');
const winston = require('winston');
const report = require('vfile-reporter');
const yaml = require('js-yaml');
const util = require('util');
const crypto = require('crypto');
const exec = require('child_process').exec;

const baseSourcePath = 'Documents/Notes';
const baseTargetPath = 'Projects/NodeJs/notes.omic.ch';
const relativeTargetPath = 'src/pages/notes';

// const baseSourcePath = 'SharedVirginie/Diaconat/Formation/Notes';
// const baseTargetPath = 'Projects/NodeJs/diaconat.omic.ch';
// const relativeTargetPath = 'src/pages/notes';

try {
    pipe(
        bootstrap,
        collectLegacyNotes,
        loadDataSource,
        // askBeforeDeleteOldNotes,
        collectAllSourceNotes,
        filterSourceNotesByLatestChange,
        formatMarkdown,
        saveDataSource,
        filterSourceNotesByTagPublic,
        deleteLegacyNotes,
        copyPublicNotesToTarget,
        commitAndPush
    )();
} catch (exception) {
    console.log(exception);
}

/**
 * @param args
 * @returns {{}}
 */
function bootstrap(args = []) {
    // Define variables
    args.basePath = path.join(process.env.HOME, baseSourcePath);
    args.targetPath = path.join(process.env.HOME, baseTargetPath);
    args.targetNotePath = path.join(args.targetPath, relativeTargetPath);
    args.dataSourcePath = path.join(__dirname, '/dataSource.json');
    return args;
}

/**
 * @param args
 * @returns {{}}
 */
function loadDataSource(args = []) {
    // If data source does not exist, create it.
    if (!fs.existsSync(args.dataSourcePath)) {
        args.dataSource = {};
        saveDataSource(args);
    }

    const content = fs.readFileSync(args.dataSourcePath, 'utf8');
    args.dataSource = JSON.parse(content);
    return args;
}

/**
 * @param args
 * @returns {{}}
 */
function collectLegacyNotes(args = []) {
    args.previousNoteFiles = getFilesFromPath(args.targetNotePath, '.md');
    return args;
}

/**
 * @param args
 * @returns {{}}
 */
// function askBeforeDeleteOldNotes(args = []) {
//     args.answers = {};
//     const questions = [
//         {
//             type: 'confirm',
//             name: 'confirmed',
//             message: `Sure to delete files in ${args.targetNotePath} (${
//                 args.previousNoteFiles.length
//             })`,
//         },
//     ];
//
//     // Does not work well!
//     // args.answers = prompt(questions);
//     return args;
// }

/**
 * @param args
 * @returns {{}}
 */
function collectAllSourceNotes(args = []) {
    args.sourceNotes = getFilesFromPath(args.basePath, '.md');
    return args;
}

/**
 * @param args
 * @returns {{}}
 */
function filterSourceNotesByLatestChange(args = []) {
    const sourceNotes = args.sourceNotes;
    args.sourceNotes = sourceNotes.filter(fileName => {
        const fileNameAndPath = path.join(args.basePath, fileName);

        const content = fs.readFileSync(fileNameAndPath, 'utf8');
        const ast = fm(content);

        let roundedTime = roundTime(ast.attributes.timeStamp);
        let roundedModifiedTime = roundTime(
            getModifiedTime(fileNameAndPath).getTime()
        );

        if (roundedTime !== roundedModifiedTime) {
            return fileNameAndPath;
        }
    });

    return args;
}

/**
 * @param {int} timeStamp
 * @returns {int}
 */
function roundTime(timeStamp) {
    return Math.round(timeStamp / 1000000.0) * 1000;
}

/**
 * @param args
 * @returns {{}}
 */
function formatMarkdown(args = []) {
    args.sourceNotes.map(fileName => {
        const sourceNoteFileNameAndPath = path.join(args.basePath, fileName);

        // write and format
        unified()
            .use(parse)
            .use(stringify, {
                bullet: '*',
                setext: true,
                looseTable: true,
                closeAtx: true,
            })
            .use(frontmatter, ['yaml', 'toml'])
            // .use(logger)
            .process(vfile.readSync(sourceNoteFileNameAndPath), (err, file) => {
                const logger = getLogger();
                logger.info(`${sourceNoteFileNameAndPath} formatted!`);

                const rawContent = fs.readFileSync(file.path, 'utf8');
                // const rawContent = file.contents.trim(); // VFile object. Bug: not fully the same content.
                const rawMd5Value = checksum(rawContent); // raw content

                if (
                    rawMd5Value !== args.dataSource[sourceNoteFileNameAndPath]
                ) {
                    let content = processFrontMatter(
                        rawContent,
                        sourceNoteFileNameAndPath
                    );

                    // Reformat markdown
                    content = formatMarkdownLinks(content);

                    // Replace line ending and other value
                    content = content.replace(/\r/g, '\n');
                    content = content.replace(/\rn/g, '\n');

                    // Store
                    args.dataSource[sourceNoteFileNameAndPath] = checksum(
                        content
                    );

                    fs.writeFileSync(
                        sourceNoteFileNameAndPath,
                        content,
                        err => {
                            if (err) throw err;
                            console.log("It's saved!");
                        }
                    );

                    const fileName = basename(sourceNoteFileNameAndPath);
                    console.log(`Updated ${fileName}`);
                }
            });
    });

    return args;
}

/**
 * @returns {{}}
 */
function saveDataSource(args = []) {
    fs.writeFileSync(
        args.dataSourcePath,
        JSON.stringify(args.dataSource),
        err => {
            if (err) throw err;
            console.log("It's saved!");
        }
    );

    return args;
}

/**
 * @param {string} content
 * @returns {string}
 */
function formatMarkdownLinks(content) {
    let pattern = new RegExp(`>\n<`, 'mg');

    if (content.match(pattern)) {
        content = content.replace(pattern, `>\n\n<`);
    }
    return content;
}

/**
 * @param {string} content
 * @param {string} sourceNoteFileNameAndPath
 * @returns {string}
 */
function processFrontMatter(content, sourceNoteFileNameAndPath) {
    const newFrontMatter = getUpdatedFrontMatter(
        content,
        sourceNoteFileNameAndPath
    );

    let optionalByteOrderMark = '\\ufeff?';
    let pattern =
        '^(' +
        optionalByteOrderMark +
        '(= yaml =|---)' +
        '$([\\s\\S]*?)' +
        '^(?:\\2|\\.\\.\\.)\\s*' +
        '$' +
        (process.platform === 'win32' ? '\\r?' : '') +
        '(?:\\n)?)';

    let regex = new RegExp(pattern, 'm');

    if (content.match(regex)) {
        content = content.replace(regex, `---\n${newFrontMatter}---\n\n`);
    } else {
        content = `---\n${newFrontMatter}---\n\n${content}`;
    }

    return content.trim();
}

/**
 * From the bunch of notes filer the ones who has the attribute "public".
 *
 * @param args
 * @returns {{}}
 */
function filterSourceNotesByTagPublic(args = []) {
    const files = getFilesFromPath(args.basePath, '.md');
    args.publicSourceNotes = files.filter(fileName => {
        const fileNameAndPath = path.join(args.basePath, fileName);

        const content = fs.readFileSync(fileNameAndPath, 'utf8');
        const ast = fm(content);
        if (ast.attributes.public) {
            return fileName;
        }
    });

    return args;
}

/**
 * @param args
 * @returns {{}}
 */
function deleteLegacyNotes(args = []) {
    args.fileLimit = 40;
    if (args.previousNoteFiles.length > args.fileLimit) {
        throw `Too many files to delete aborting.
        File limit was set to ${args.fileLimit}`;
    }
    args.previousNoteFiles.map(fileName => {
        const fileNameAndPath = path.join(args.targetNotePath, fileName);
        if (fs.existsSync(fileNameAndPath)) {
            fs.unlink(path.join(args.targetNotePath, fileName), err => {
                if (err) throw err;
            });
        } else {
            throw `file does not exist "${fileNameAndPath}"`;
        }
    });

    return args;
}

/**
 * @param args
 * @returns {{}}
 */
function copyPublicNotesToTarget(args = []) {
    console.log('');
    args.publicSourceNotes.map(fileName => {
        const sourceNoteFileNameAndPath = path.join(args.basePath, fileName);
        const targetFileNameAndPath = path.join(
            args.targetNotePath,
            fileName.replace('--', '')
        );
        fse.copySync(sourceNoteFileNameAndPath, targetFileNameAndPath);
        console.log(`Published ${fileName}`);
    });
    return args;
}

/**
 * @param args
 * @returns {{}}
 */
function commitAndPush(args = []) {
    const cd = `cd ${args.targetPath}`;
    let command = `${cd}; git status -s`;
    const dir = exec(command, (err, stdout) => {
        console.log('');
        console.log(stdout);
        if (stdout) {
            console.log('');
            console.log('Committing...');

            // Commit
            const message = `Update notes ${formatDatetime(new Date())}`;
            command = `${cd}; git add .; git commit -s -m "${message}"`;
            exec(command, (err, stdout) => {
                console.log('Pushing...');
                command = `${cd}; git push`;
                exec(command, (err, stdout) => {
                    if (err) {
                        console.log(err);
                    }
                    console.log(stdout);
                });
            });
        } else {
            console.log('');
            console.log('Nothing new to commit...');
        }
    });
    return args;
}

/**
 *
 * @param {string} path
 * @param {string} extension
 * @returns []
 */
function getFilesFromPath(path, extension) {
    let directory = fs.readdirSync(path);
    return directory.filter(file =>
        file.match(new RegExp(`.*\.(${extension})`, 'ig'))
    );
}

/**
 *
 * @param {string} fileNameAndPath
 * @returns {Date}
 */
function getModifiedTime(fileNameAndPath) {
    const stats = fs.statSync(fileNameAndPath);
    return new Date(util.inspect(stats.mtime));
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
    let month = '' + (date.getMonth() + 1),
        day = '' + date.getDate(),
        year = date.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [day, month, year].join('.');
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatDatetime(date) {
    let month = '' + (date.getMonth() + 1),
        day = '' + date.getDate(),
        year = date.getFullYear(),
        hours = '' + date.getHours(),
        minutes = '' + date.getMinutes(),
        seconds = '' + date.getSeconds();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return (
        [day, month, year].join('.') +
        ' @ ' +
        [hours, minutes, seconds].join(':')
    );
}

/**
 * @param {string} content
 * @param {string} fileName
 * @returns {string}
 */
function getUpdatedFrontMatter(content, fileName) {
    const ast = fm(content);

    // Update the modification date
    let modifiedTime = getModifiedTime(fileName);
    ast.attributes.date = modifiedTime;
    // ast.attributes.timeStamp = modifiedTime.getTime();
    delete ast.attributes.timeStamp;

    // Define a title if not yet defined
    if (!ast.attributes.title) {
        let title = path
            .basename(fileName)
            .replace('--', '')
            .split('.')
            .slice(0, -1)
            .join('.');
        ast.attributes.title = capitalizeFirstLetter(title);
    }

    // Dump database
    return yaml.safeDump(ast.attributes, {
        sortKeys: true, // sort object keys
    });
}

/**
 *
 * @param content
 * @returns {PromiseLike<ArrayBuffer>}
 */
function checksum(content) {
    return crypto
        .createHash('md5')
        .update(content, 'utf8')
        .digest('hex');
}

/**
 * @param string
 * @returns {string}
 */
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * @param {string} file
 */
function basename(file) {
    return file.split('/').reverse()[0];
}

/**
 * @returns {winston.Logger}
 */
function getLogger() {
    return winston.createLogger({
        levels: winston.config.syslog.levels,
        transports: [
            // new winston.transports.Console({ level: 'info' }),
            new winston.transports.File({
                filename: 'combined.log',
                level: 'info',
            }),
        ],
    });
}
