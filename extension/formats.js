// File types captured from browser downloads by default (no size limit), grouped by kind.
// Keep the groups in sync with CATEGORIES in frontend/src/state/store.js.
var DM_FORMATS = {
  video: 'mp4 m4v mkv webm avi mov wmv flv f4v mpg mpeg mpe m2v m2ts mts ts vob 3gp 3g2 ogv rm rmvb asf divx xvid hevc h264 h265 mxf',
  audio: 'mp3 m4a m4b aac flac wav wave aiff aif alac ogg oga opus wma ape wv mka mid midi amr ac3 dts caf ra au',
  image: 'jpg jpeg jpe jfif png gif webp avif heic heif bmp tif tiff svg svgz ico icns psd ai eps raw cr2 cr3 nef arw dng orf rw2 raf xcf jxl tga exr hdr',
  document: 'pdf doc docx docm dot dotx odt rtf txt md tex xls xlsx xlsm xlsb ods csv tsv ppt pptx pps ppsx odp key pages numbers epub mobi azw azw3 fb2 djvu xps oxps chm',
  app: 'exe msi msix msixbundle appx appxbundle dmg pkg mpkg app deb rpm appimage flatpak snap apk apks xapk aab ipa jar run bin sh bat cmd vsix crx xpi',
  archive: 'zip rar 7z tar gz tgz bz2 tbz2 xz txz zst tzst lz lzma lz4 z cab arj ace lha lzh sit sitx war ear cpio pak',
  diskImage: 'iso img dmg vhd vhdx vmdk vdi qcow2 ova ovf toast nrg mdf mds cue bin wim esd',
  other: 'torrent',
};
var DM_DEFAULT_EXTENSIONS = [...new Set(Object.values(DM_FORMATS).join(' ').split(/\s+/))].join(' ');
