import { convertLegacyOffice } from './convertOffice';
export { OfficeConversionError as PptConversionError } from './convertOffice';

export function convertLegacyPpt(source: Uint8Array) {
	return convertLegacyOffice(source, 'ppt');
}
