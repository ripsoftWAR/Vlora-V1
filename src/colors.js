const c = (code) => (text) => `\x1b[${code}m${text}\x1b[0m`;

export const chalk = {
  green:   c('32'),
  cyan:    c('36'),
  yellow:  c('33'),
  red:     c('31'),
  blue:    c('34'),
  gray:    c('90'),
  white:   c('37'),
  dim:     c('2'),
  bold:    Object.assign(c('1'), {
    white: (t) => `\x1b[1;37m${t}\x1b[0m`,
    green: (t) => `\x1b[1;32m${t}\x1b[0m`,
  }),
};
