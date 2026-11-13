# Bundled font

`NotoSansTC-Regular.ttf` is embedded in generated PDF files (for example the session sign-in sheet) so that
Latin, Spanish and Traditional Chinese names print the same everywhere, without depending on fonts installed
in the container or on the reader's computer.

It is a modified version of Noto Sans TC 2.004 (Google Fonts `ofl/notosanstc`), licensed under the SIL Open
Font License 1.1 (see `OFL.txt`): the variable font was instantiated at regular weight (400) with fontTools
and the layout, hinting and vertical-metric tables, which PDF generation does not use, were removed. All
characters of the original are kept.
