# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [1.2.0] - 2026-11-24

### Adicionado
- Opção **Nenhum** nos estilos predefinidos de sombra para remover a sombra da imagem (mantendo **Médio** como padrão inicial e no reset) (#14).
- Módulo de arredondamento de bordas (`Bordas` no rail de ferramentas) com presets rápidos (`Nenhum`, `Sutil`, `Médio`, `Forte`), controle de raio geral, cantos individuais na gaveta colapsável e suporte completo em preview, cópia, exportação multi-formato e GIFs animados (#10).
- Animações fluidas de abrir, fechar e trocar de opção no painel de ferramentas com respeito a `prefers-reduced-motion` (#11).
- Rodapé flutuante com status contextual, miniaturas dos arquivos abertos em lote, scroll horizontal com fade nas extremidades e ações rápidas (`+ Adicionar` / `Limpar`) (#12).

### Corrigido
- Cálculo direcional de margem automática (`calculateSmartPadding`) e ajuste dos presets de sombra para evitar bordas vazias excessivas sem cortar o blur nas extremidades (`e900a79`).

## [1.1.0] - 2026-11-17

### Adicionado
- **Suporte a lote (múltiplas imagens):** upload, Drag & Drop e Paste (`Ctrl+V`) de múltiplos arquivos de uma vez, com barra de fila para alternar o preview, remover itens ou adicionar novos arquivos (`+ Adicionar` / `Limpar`).
- **Suporte completo a GIFs animados:** decodificação de frames e delays no cliente (`gifuct-js`), preview animado ao vivo com aplicação da sombra em tempo real e exportação em `.gif` (`gifenc`) preservando todos os frames.
- **Opções de saída no botão de exportação:** split-button no header (`Exportar | ▾`) com popover nativo (`popover="auto"`) para seleção de formato (`PNG`, `WebP`, `AVIF`, `JPEG`), estimativa de tamanho e controle de qualidade.
- **Steppers customizados (`−` / `+`):** controles numéricos harmonizados sem setinhas nativas do navegador.

### Alterado
- **Identidade visual sóbria (`mind-light-style`):** redesign completo em ilhas flutuantes separadas (header, rail de ferramentas com ícone `eclipse` da Lucide, propriedades da sombra e palco amplo), paleta neutra com roxo contido (`#6741d9`) e gaveta `Personalizar` fechada por padrão.
- **Nomenclatura de exportação:** arquivos exportados passaram a usar o sufixo `_sombreado` separado por underscore (ex: `nometal_sombreado.png`, `nometal_sombreado.gif`).

### Corrigido
- Alinhamento uniforme (`h-8` + `items-stretch`) entre o botão `Exportar` e o seletor de formato no header, além do espaçamento entre `Exportar` e a extensão.

## [1.0.0] - 2026-11-10

### Adicionado
- Renderização client-side de drop shadow inteligente via Canvas 2D com padding dinâmico anti-corte.
- Presets rápidos (`Leve`, `Médio`, `Forte`, `Flutuante`), controles manuais de deslocamento, blur, opacidade e margem extra.
- Workflow de clipboard (`Ctrl+V` / `Ctrl+C`), Drag & Drop e exportação multi-formato (`PNG`, `WebP`, `AVIF`, `JPEG`).
- Palco com viewport fixa, auto-ajuste, zoom focalizado, pan e alternância de fundo (`Grade`, `Claro`, `Escuro`).
- Containerização multi-arch (`linux/amd64`, `linux/arm64`) publicada no GHCR.

[Não lançado]: https://github.com/luizGDpulz/image-polisher/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/luizGDpulz/image-polisher/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/luizGDpulz/image-polisher/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/luizGDpulz/image-polisher/releases/tag/v1.0.0
