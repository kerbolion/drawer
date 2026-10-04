export const minifyOptions = {
  ecma: 2020,
  compress: {
    drop_console: true,
    drop_debugger: true,
    passes: 1
  },
  mangle: true,
  format: {
    comments: false
  }
};
