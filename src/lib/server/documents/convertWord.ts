import { convertLegacyOffice } from './convertOffice';
export { OfficeConversionError as WordConversionError } from './convertOffice';

export function convertLegacyWord(source: Uint8Array) {
	return convertLegacyOffice(source, 'doc');
}
