
/**
 * @param f
 * @param g
 * @returns {function(...[*]): *}
 * @private
 */
const _pipe = (f, g) => (...args) => g(f(...args));

/**
 * @param fns
 * @returns {*|(function(...[*]): *)}
 */
const pipe = (...fns) => fns.reduce(_pipe);

module.exports = pipe
