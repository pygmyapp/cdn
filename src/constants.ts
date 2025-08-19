export const Errors = {
  ServerError: 'Server Error',

  // Auth
  InvalidToken: 'Invalid token',
  InvalidTokenType: 'Invalid token type',

  // Upload
  MissingFile: 'Missing file upload',
  MissingBucket: 'Missing bucket',
  InvalidBucket: 'Specified bucket does not exist',
  InvalidFileType: 'Invalid or unaccepted file type',
  ExceedsSizeLimit: 'File exceeds upload size limit',

  // Fetch
  MissingID: 'Missing ID',
  FileNotFound: 'File not found',
  InvalidImageType: 'Invalid image type/extension',

  // Delete
  Forbidden: 'Forbidden (insufficient privlidges to delete object)'
};
