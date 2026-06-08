import type { AppProps } from 'next/app'
import Head from 'next/head'
import '../src/styles/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>NADA STUDIO</title>
        <meta name="description" content="Convert & pitch audio from YouTube, SoundCloud, TikTok — upload ke Roblox" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&family=Cabinet+Grotesk:wght@300;400;500;700;800;900&display=swap" rel="stylesheet" />
      </Head>
      <Component {...pageProps} />
    </>
  )
}
