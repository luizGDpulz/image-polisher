# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

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
