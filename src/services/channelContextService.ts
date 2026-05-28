// ═══════════════════════════════════════════════════════════════════════════
//  channelContextService — Estrutura de canais do Fluxo Command.
//
//  Define os canais de atendimento suportados e seus status de conexão.
//  Cada canal tem: status, provider, regras, capacidades.
//
//  Próximos passos para conectar canais reais:
//  - WhatsApp: Evolution API (já funcional) ou WhatsApp Cloud API
//  - Instagram: Meta Graph API + webhook /api/webhook/meta + page token
//  - Facebook: Meta Graph API + webhook /api/webhook/meta + page token
//  - Site: Fluxo Widget (script JS injetável) — a implementar
// ═══════════════════════════════════════════════════════════════════════════

export type ChannelName       = 'whatsapp' | 'instagram' | 'facebook' | 'site' | 'simulator';
export type ConnectionStatus  = 'connected' | 'pending' | 'not_configured' | 'coming_soon';

export interface ChannelConfig {
  channelName:           ChannelName;
  displayName:           string;
  enabled:               boolean;
  connectionStatus:      ConnectionStatus;
  provider?:             string;
  externalId?:           string;
  supportsHumanHandoff:  boolean;
  supportsCatalog:       boolean;
  supportsMedia:         boolean;
  setupNote?:            string;
}

export interface ChannelContextOptions {
  evolutionConfigured?: boolean;
  aiConfigured?:        boolean;
}

export function getChannelContext(
  channelName: ChannelName,
  opts: ChannelContextOptions = {},
): ChannelConfig {
  const evo = opts.evolutionConfigured ?? false;

  const configs: Record<ChannelName, ChannelConfig> = {

    whatsapp: {
      channelName:          'whatsapp',
      displayName:          'WhatsApp',
      enabled:              evo,
      connectionStatus:     evo ? 'connected' : 'not_configured',
      provider:             'Evolution API',
      supportsHumanHandoff: true,
      supportsCatalog:      true,
      supportsMedia:        true,
      setupNote:            evo ? undefined : 'Configure a Evolution API para ativar o canal.',
    },

    instagram: {
      channelName:          'instagram',
      displayName:          'Instagram',
      enabled:              false,
      connectionStatus:     'pending',
      provider:             'Meta Graph API',
      supportsHumanHandoff: true,
      supportsCatalog:      true,
      supportsMedia:        true,
      setupNote:            'Requer: webhook Meta + token de página + aprovação de app.',
    },

    facebook: {
      channelName:          'facebook',
      displayName:          'Facebook',
      enabled:              false,
      connectionStatus:     'coming_soon',
      provider:             'Meta Graph API',
      supportsHumanHandoff: true,
      supportsCatalog:      true,
      supportsMedia:        true,
      setupNote:            'Em breve. Mesma infraestrutura do Instagram (webhook Meta).',
    },

    site: {
      channelName:          'site',
      displayName:          'Chat no Site',
      enabled:              false,
      connectionStatus:     'coming_soon',
      provider:             'Fluxo Widget',
      supportsHumanHandoff: false,
      supportsCatalog:      true,
      supportsMedia:        false,
      setupNote:            'Em breve. Widget JS injetável em qualquer site.',
    },

    simulator: {
      channelName:          'simulator',
      displayName:          'Simulador',
      enabled:              true,
      connectionStatus:     'connected',
      provider:             'Fluxo Command',
      supportsHumanHandoff: false,
      supportsCatalog:      true,
      supportsMedia:        false,
    },
  };

  return configs[channelName];
}

export function getAllChannels(opts: ChannelContextOptions = {}): ChannelConfig[] {
  const names: ChannelName[] = ['whatsapp', 'instagram', 'facebook', 'site', 'simulator'];
  return names.map(n => getChannelContext(n, opts));
}
