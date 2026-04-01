import ImageKit from 'imagekit';
import { env } from '$env/dynamic/private';

if (!env.IMAGEKIT_PUBLIC_KEY) throw new Error('IMAGEKIT_PUBLIC_KEY is not set');
if (!env.IMAGEKIT_PRIVATE_KEY) throw new Error('IMAGEKIT_PRIVATE_KEY is not set');
if (!env.IMAGEKIT_URL_ENDPOINT) throw new Error('IMAGEKIT_URL_ENDPOINT is not set');

export const imagekit = new ImageKit({
	publicKey: env.IMAGEKIT_PUBLIC_KEY,
	privateKey: env.IMAGEKIT_PRIVATE_KEY,
	urlEndpoint: env.IMAGEKIT_URL_ENDPOINT
});

export const IMAGEKIT_PUBLIC_KEY = env.IMAGEKIT_PUBLIC_KEY;
export const IMAGEKIT_URL_ENDPOINT = env.IMAGEKIT_URL_ENDPOINT;
