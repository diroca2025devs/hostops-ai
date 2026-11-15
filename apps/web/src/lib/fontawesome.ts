import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';

// O CSS é importado acima (uma vez); evita injeção em runtime e "flash" de ícones gigantes.
config.autoAddCss = false;
