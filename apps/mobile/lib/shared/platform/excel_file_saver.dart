import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';

typedef ExcelFileSaver =
    Future<Uri?> Function({
      required Uint8List bytes,
      required String fileName,
    });

Future<Uri?> saveExcelFile({
  required Uint8List bytes,
  required String fileName,
}) {
  return FilePicker.saveFile(
    dialogTitle: fileName,
    fileName: fileName,
    type: FileType.custom,
    allowedExtensions: const ['xlsx'],
    bytes: bytes,
    mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}
