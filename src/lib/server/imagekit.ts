import ImageKit from 'imagekit';
import { env } from '$env/dynamic/private';

let _imagekit: ImageKit | null = null;

function getImageKit(): ImageKit | null {
	if (_imagekit) return _imagekit;
	const publicKey = env.IMAGEKIT_PUBLIC_KEY;
	const privateKey = env.IMAGEKIT_PRIVATE_KEY;
	const urlEndpoint = env.IMAGEKIT_URL_ENDPOINT;
	if (!publicKey || !privateKey || !urlEndpoint) {
		console.warn(
			'[ImageKit] Missing environment variables (IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT). Image upload features are disabled.'
		);
		return null;
	}
	_imagekit = new ImageKit({ publicKey, privateKey, urlEndpoint });
	return _imagekit;
}

export { getImageKit as imagekit };

export const IMAGEKIT_PUBLIC_KEY = env.IMAGEKIT_PUBLIC_KEY ?? '';
export const IMAGEKIT_URL_ENDPOINT = env.IMAGEKIT_URL_ENDPOINT ?? '';
