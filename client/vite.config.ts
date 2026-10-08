import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
export default defineConfig({ plugins: [(uni as unknown as {default:typeof uni}).default()], server: { host:'127.0.0.1',port:8765,strictPort:true }, build:{sourcemap:false} });
