# Image Polisher

Estúdio web utilitário **100% client-side** e ultra-leve para aplicar sombras projetadas (*drop shadow*) suaves, margem inteligente anti-corte e compressão multi-formato em capturas de tela (prints de sistemas, PFs da Secullum, documentações técnicas e chamados).

---

## Principais Funcionalidades

1. **Fluxo Sem Arquivos (`Ctrl + V` $\rightarrow$ `Ctrl + C`):**
   * Cole prints diretamente da Área de Transferência com `Ctrl + V` em qualquer lugar da página, arraste arquivos (*Drag & Drop*) ou selecione pelo navegador.
   * Copie a imagem sombreada de volta para a Área de Transferência com `Ctrl + C` (ou no botão **Copiar**) para colar direto em chamados e documentos.
2. **Margem Dinâmica Anti-Corte:**
   * Calcula automaticamente o *padding* necessário no `<canvas>` com base no raio do *blur* e no deslocamento X/Y ($\text{blur} \times 2 + |\text{offset}|$), garantindo que a sombra nunca saia cortada nas bordas.
3. **Exportação Multi-Formato & Compressão:**
   * Exportação nativa para **PNG** (lossless), **WebP** (comprimido com transparência), **AVIF** (ultra-comprimido) e **JPEG** (com preenchimento automático de fundo branco).
   * Controle de qualidade (`10%` a `100%`) com estimativa em tempo real do tamanho do arquivo e percentual de redução.
4. **Preview de Contraste & Dark Mode Nativo:**
   * Alterne o fundo do palco entre **Transparente (Quadriculado)**, **Claro** e **Escuro** para validar o acabamento da sombra antes de exportar.

---

## Stack Tecnológica

* **Framework:** [Astro](https://astro.build/) + TypeScript Estrito
* **Estilização:** [Tailwind CSS v4](https://tailwindcss.com/) + CSS `light-dark()` / `color-scheme`
* **Gerenciador de Pacotes:** `pnpm`
* **Runtime de Produção:** `nginx:alpine` hardened (execução não-root `USER nginx` na porta `8080`, consumo `< 10 MB` RAM)
* **CI/CD:** GitHub Actions Multi-Arch (`linux/amd64`, `linux/arm64`) $\rightarrow$ GitHub Container Registry (`ghcr.io/luizgdpulz/image-polisher:latest`)

---

## Desenvolvimento Local

```bash
# Instalar dependências
pnpm install

# Iniciar servidor de desenvolvimento
pnpm run dev

# Gerar build estático de produção
pnpm run build
```

---

## Deploy via Docker (Pull-Only / GHCR)

```yaml
services:
  image-polisher:
    image: ghcr.io/luizgdpulz/image-polisher:latest
    container_name: image-polisher
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    expose:
      - "8080"
    networks:
      - proxy-net

networks:
  proxy-net:
    external: true
```

---

## Licença

Distribuído sob a licença [MIT](./LICENSE).
