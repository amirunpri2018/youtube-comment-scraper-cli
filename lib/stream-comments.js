const Task = require('data.task')
const Readable = require('stream').Readable
const fs = require('fs')
const scrapeComments = require('youtube-comments-task')

const collapseReplies = require('./collapse-replies')
const csv = require('./csv')
const json = require('./json')

const processComments = (opts, comments) =>
  (opts.collapseReplies
    ? comments.reduce((acc, c) => acc.concat(collapseReplies(c)), [])
    : comments).map(
    c =>
      (opts.format === 'csv' ? csv.commentToCsv(opts, c) : json.generateJson(c))
  )

const formatStreamMsg = opts => data =>
  (opts.format === 'json' ? `${data}\n` : data)

const buildStream = (videoId, opts) => {
  const rs = Readable()
  const format = formatStreamMsg(opts)
  let streamNextPageToken = null
  let commentBuffer = null

  rs._read = () => {
    if (commentBuffer && commentBuffer.length) {
      // push comments from buffer onto the stream
      rs.push(format(commentBuffer.splice(0, 1)[0]))
    } else if (streamNextPageToken || !commentBuffer) {
      // fetch more comments if buffer is empty
      commentBuffer = []
      scrapeComments(videoId, streamNextPageToken)
        .map(commentPage => {
          processComments(opts, commentPage.comments).forEach(c =>
            commentBuffer.push(c)
          )
          streamNextPageToken = commentPage.nextPageToken
          return commentPage
        })
        .fork(
          err => rs.emit('error', err),
          () => rs.push(format(commentBuffer.splice(0, 1)[0]))
        )
    } else {
      // all comments have been fetched. End the stream.
      rs.push(null)
    }
  }

  return rs
}

module.exports = ({ videoId, opts }) => {
  return new Task((rej, res) => {
    const rs = buildStream(videoId, opts)
    rs.on('error', rej)
    rs.on('end', res)

    const { stdout, outputFile } = opts

    if (!stdout && !outputFile) {
      return rej('No output defined needs (opts.stdout or opts.outputFile)')
    }

    if (opts.outputFile) {
      try {
        rs.pipe(fs.createWriteStream(opts.outputFile))
      } catch (e) {
        return rej(e)
      }
    }

    if (opts.stdout) {
      rs.pipe(process.stdout)
    }
  })
}
