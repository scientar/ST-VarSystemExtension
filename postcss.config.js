import autoprefixer from 'autoprefixer';
import tailwindcss from '@tailwindcss/postcss';
import postcssMinify from 'postcss-minify';

/** @type {import('postcss-load-config').Config} */
export default {
  plugins: [autoprefixer, tailwindcss, postcssMinify],
};
