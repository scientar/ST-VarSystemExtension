import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import unpluginAutoImport from 'unplugin-auto-import/vite';
import { VueUseComponentsResolver, VueUseDirectiveResolver } from 'unplugin-vue-components/resolvers';
import unpluginVueComponents from 'unplugin-vue-components/vite';
import { defineConfig } from 'vite';
import pluginExternal from 'vite-plugin-external';

const externals = {
  jquery: '$',
  hljs: 'hljs',
  lodash: '_',
  toastr: 'toastr',
  '@popperjs/core': 'Popper',
} as const;

// 修复路径计算：使用固定的相对路径
// 扩展安装位置：public/scripts/extensions/third-party/ST-VarSystemExtension/dist/
// 到 public/ 的相对路径：../../../../..（向上 5 层）
const relative_sillytavern_path = '../../../../..';

export default defineConfig(({ mode }) => ({
  plugins: [
    vue({
      features: {
        optionsAPI: false,
        prodDevtools: process.env.CI !== 'true',
        prodHydrationMismatchDetails: false,
      },
    }),
    unpluginAutoImport({
      dts: true,
      dtsMode: 'overwrite',
      imports: [
        'vue',
        'pinia',
        '@vueuse/core',
        { from: '@sillytavern/scripts/i18n', imports: ['t'] },
        { from: 'klona', imports: ['klona'] },
        { from: 'vue-final-modal', imports: ['useModal'] },
        { from: 'zod', imports: ['z'] },
      ],
      dirs: [{ glob: './src/**/composable', types: true }],
    }),
    unpluginVueComponents({
      dts: true,
      syncMode: 'overwrite',
      // globs: ['src/panel/component/*.vue'],
      resolvers: [VueUseComponentsResolver(), VueUseDirectiveResolver()],
    }),
    {
      name: 'sillytavern_resolver',
      enforce: 'pre',
      resolveId(id) {
        if (id.startsWith('@sillytavern/')) {
          return {
            id: path.join(relative_sillytavern_path, id.replace('@sillytavern/', '')).replaceAll('\\', '/') + '.js',
            external: true,
          };
        }
      },
    },
    pluginExternal({
      externals: libname => {
        if (libname in externals) {
          return externals[libname as keyof typeof externals];
        }
      },
    }),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },

  build: {
    rollupOptions: {
      input: 'src/index.ts',
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '[name].[hash].chunk.js',
        assetFileNames: '[name].[ext]',
        preserveModules: false,
      },
    },

    outDir: 'dist',
    emptyOutDir: false,

    sourcemap: mode === 'production' ? true : 'inline',

    minify: mode === 'production' ? 'terser' : false,
    terserOptions:
      mode === 'production'
        ? {
            format: { quote_style: 1 },
            mangle: { reserved: ['_', 'toastr', 'YAML', '$', 'z'] },
          }
        : {
            format: { beautify: true, indent_level: 2 },
            compress: false,
            mangle: false,
          },

    target: 'esnext',
  },
}));
