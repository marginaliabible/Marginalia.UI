/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
	readonly VITE_AUTH_SERVICE_URL?: string;
	readonly VITE_GOOGLE_CLIENT_ID?: string;
	readonly VITE_MICROSOFT_CLIENT_ID?: string;
	readonly VITE_GITHUB_CLIENT_ID?: string;
	readonly VITE_SANCTUM?: string;
	readonly VITE_STORAGE_PUBLIC_BASE_URL?: string;
	readonly VITE_DOCUMENT_RENDER_EPOCH?: string;
	readonly VITE_EXTERNAL_DEV_HOST?: string;
}

declare const __SANCTUM__: boolean;
