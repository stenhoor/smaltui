// File System Access API members that TypeScript's DOM library does not declare yet (Chromium only; the code checks
// for them or calls them inside try/catch).
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface OpenFilePickerOptions {
  types?: { description?: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
}

interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}
