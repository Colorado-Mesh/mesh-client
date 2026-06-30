/** Ported from liamcottle/rnode-flasher index.html product catalog. */
import type { RNodeProduct } from './types';

export const FIRMWARE_PRODUCTS: RNodeProduct[] = [
  {
    name: 'Heltec LoRa32 v2',
    catalogKey: 'heltec-lora32-v2',
    id: 0xc0,
    platform: 0x80,
    models: [
      {
        id: 0xc4,
        name: '433 MHz',
      },
      {
        id: 0xc9,
        name: '868 MHz / 915 MHz / 923 MHz',
      },
    ],
    firmware_filename: 'rnode_firmware_heltec32v2.zip',
    flash_config: {
      flash_size: '8MB',
      flash_files: {
        '0xe000': 'rnode_firmware_heltec32v2.boot_app0',
        '0x1000': 'rnode_firmware_heltec32v2.bootloader',
        '0x10000': 'rnode_firmware_heltec32v2.bin',
        '0x210000': 'console_image.bin',
        '0x8000': 'rnode_firmware_heltec32v2.partitions',
      },
    },
  },
  {
    name: 'Heltec LoRa32 v3',
    catalogKey: 'heltec-lora32-v3',
    id: 0xc1,
    platform: 0x80,
    models: [
      {
        id: 0xc5,
        name: '433 MHz',
      },
      {
        id: 0xca,
        name: '868 MHz / 915 MHz / 923 MHz',
      },
    ],
    firmware_filename: 'rnode_firmware_heltec32v3.zip',
    flash_config: {
      flash_size: '8MB',
      flash_files: {
        '0xe000': 'rnode_firmware_heltec32v3.boot_app0',
        '0x0': 'rnode_firmware_heltec32v3.bootloader',
        '0x10000': 'rnode_firmware_heltec32v3.bin',
        '0x210000': 'console_image.bin',
        '0x8000': 'rnode_firmware_heltec32v3.partitions',
      },
    },
  },
  {
    name: 'Heltec LoRa32 v4',
    catalogKey: 'heltec-lora32-v4',
    id: 0xc3,
    platform: 0x80,
    models: [
      {
        id: 0xc8,
        name: '868 MHz / 915 MHz / 923 MHz with PA',
      },
    ],
    firmware_filename: 'rnode_firmware_heltec32v4pa.zip',
    flash_config: {
      flash_size: '16MB',
      flash_files: {
        '0xe000': 'rnode_firmware_heltec32v4pa.boot_app0',
        '0x0': 'rnode_firmware_heltec32v4pa.bootloader',
        '0x10000': 'rnode_firmware_heltec32v4pa.bin',
        '0x210000': 'console_image.bin',
        '0x8000': 'rnode_firmware_heltec32v4pa.partitions',
      },
    },
  },
  {
    name: 'Heltec T114',
    catalogKey: 'heltec-t114',
    id: 0xc2,
    platform: 0x70,
    models: [
      {
        id: 0xc6,
        name: '470-510 MHz (HT-n5262-LF)',
      },
      {
        id: 0xc7,
        name: '863-928 MHz (HT-n5262-HF)',
      },
    ],
    firmware_filename: 'rnode_firmware_heltec_t114.zip',
  },
  {
    name: 'LilyGO LoRa32 v1.0',
    catalogKey: 'lilygo-lora32-v1',
    id: 0xb2,
    platform: 0x80,
    models: [
      {
        id: 0xba,
        name: '433 MHz',
      },
      {
        id: 0xbb,
        name: '868 MHz / 915 MHz / 923 MHz',
      },
    ],
    firmware_filename: 'rnode_firmware_lora32v10.zip',
    flash_config: {
      flash_size: '4MB',
      flash_files: {
        '0xe000': 'rnode_firmware_lora32v10.boot_app0',
        '0x1000': 'rnode_firmware_lora32v10.bootloader',
        '0x10000': 'rnode_firmware_lora32v10.bin',
        '0x210000': 'console_image.bin',
        '0x8000': 'rnode_firmware_lora32v10.partitions',
      },
    },
  },
  {
    name: 'LilyGO LoRa32 v2.0',
    catalogKey: 'lilygo-lora32-v2',
    id: 0xb0,
    platform: 0x80,
    models: [
      {
        id: 0xb3,
        name: '433 MHz',
      },
      {
        id: 0xb8,
        name: '868 MHz / 915 MHz / 923 MHz',
      },
    ],
    firmware_filename: 'rnode_firmware_lora32v20.zip',
    flash_config: {
      flash_size: '4MB',
      flash_files: {
        '0xe000': 'rnode_firmware_lora32v20.boot_app0',
        '0x1000': 'rnode_firmware_lora32v20.bootloader',
        '0x10000': 'rnode_firmware_lora32v20.bin',
        '0x210000': 'console_image.bin',
        '0x8000': 'rnode_firmware_lora32v20.partitions',
      },
    },
  },
  {
    name: 'LilyGO LoRa32 v2.1',
    catalogKey: 'lilygo-lora32-v2-1',
    id: 0xb1,
    platform: 0x80,
    models: [
      {
        id: 0xb4,
        name: '433 MHz',
        firmware_filename: 'rnode_firmware_lora32v21.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_lora32v21.boot_app0',
            '0x1000': 'rnode_firmware_lora32v21.bootloader',
            '0x10000': 'rnode_firmware_lora32v21.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_lora32v21.partitions',
          },
        },
      },
      {
        id: 0xb9,
        name: '868/915/923 MHz',
        firmware_filename: 'rnode_firmware_lora32v21.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_lora32v21.boot_app0',
            '0x1000': 'rnode_firmware_lora32v21.bootloader',
            '0x10000': 'rnode_firmware_lora32v21.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_lora32v21.partitions',
          },
        },
      },
      {
        id: 0x04,
        mapped_id: 0xb4,
        name: '433 MHz, with TCXO',
        firmware_filename: 'rnode_firmware_lora32v21_tcxo.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_lora32v21_tcxo.boot_app0',
            '0x1000': 'rnode_firmware_lora32v21_tcxo.bootloader',
            '0x10000': 'rnode_firmware_lora32v21_tcxo.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_lora32v21_tcxo.partitions',
          },
        },
      },
      {
        id: 0x09,
        mapped_id: 0xb9,
        name: '868/915/923 MHz, with TCXO',
        firmware_filename: 'rnode_firmware_lora32v21_tcxo.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_lora32v21_tcxo.boot_app0',
            '0x1000': 'rnode_firmware_lora32v21_tcxo.bootloader',
            '0x10000': 'rnode_firmware_lora32v21_tcxo.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_lora32v21_tcxo.partitions',
          },
        },
      },
    ],
  },
  {
    name: 'LilyGO LoRa T3S3',
    catalogKey: 'lilygo-lora-t3s3',
    id: 0x03,
    platform: 0x80,
    models: [
      {
        id: 0xa5,
        name: '433 MHz (with SX1278 chip)',
        firmware_filename: 'rnode_firmware_t3s3_sx127x.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_t3s3_sx127x.boot_app0',
            '0x0': 'rnode_firmware_t3s3_sx127x.bootloader',
            '0x10000': 'rnode_firmware_t3s3_sx127x.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_t3s3_sx127x.partitions',
          },
        },
      },
      {
        id: 0xaa,
        name: '868/915/923 MHz (with SX1276 chip)',
        firmware_filename: 'rnode_firmware_t3s3_sx127x.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_t3s3_sx127x.boot_app0',
            '0x0': 'rnode_firmware_t3s3_sx127x.bootloader',
            '0x10000': 'rnode_firmware_t3s3_sx127x.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_t3s3_sx127x.partitions',
          },
        },
      },
      {
        id: 0xa1,
        name: '433 MHz (with SX1268 chip)',
        firmware_filename: 'rnode_firmware_t3s3.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_t3s3.boot_app0',
            '0x0': 'rnode_firmware_t3s3.bootloader',
            '0x10000': 'rnode_firmware_t3s3.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_t3s3.partitions',
          },
        },
      },
      {
        id: 0xa6,
        name: '868/915/923 MHz (with SX1262 chip)',
        firmware_filename: 'rnode_firmware_t3s3.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_t3s3.boot_app0',
            '0x0': 'rnode_firmware_t3s3.bootloader',
            '0x10000': 'rnode_firmware_t3s3.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_t3s3.partitions',
          },
        },
      },
      {
        id: 0xac,
        name: '2.4 GHz (with SX1280 chip)',
        firmware_filename: 'rnode_firmware_t3s3_sx1280_pa.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_t3s3_sx1280_pa.boot_app0',
            '0x0': 'rnode_firmware_t3s3_sx1280_pa.bootloader',
            '0x10000': 'rnode_firmware_t3s3_sx1280_pa.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_t3s3_sx1280_pa.partitions',
          },
        },
      },
    ],
  },
  {
    name: 'LilyGO T-Beam',
    catalogKey: 'lilygo-t-beam',
    id: 0xe0,
    platform: 0x80,
    models: [
      {
        id: 0xe4,
        name: '433 MHz (with SX1278 chip)',
        firmware_filename: 'rnode_firmware_tbeam.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_tbeam.boot_app0',
            '0x1000': 'rnode_firmware_tbeam.bootloader',
            '0x10000': 'rnode_firmware_tbeam.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_tbeam.partitions',
          },
        },
      },
      {
        id: 0xe9,
        name: '868/915/923 MHz (with SX1276 chip)',
        firmware_filename: 'rnode_firmware_tbeam.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_tbeam.boot_app0',
            '0x1000': 'rnode_firmware_tbeam.bootloader',
            '0x10000': 'rnode_firmware_tbeam.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_tbeam.partitions',
          },
        },
      },
      {
        id: 0xe3,
        name: '433 MHz (with SX1268 chip)',
        firmware_filename: 'rnode_firmware_tbeam_sx1262.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_tbeam_sx1262.boot_app0',
            '0x1000': 'rnode_firmware_tbeam_sx1262.bootloader',
            '0x10000': 'rnode_firmware_tbeam_sx1262.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_tbeam_sx1262.partitions',
          },
        },
      },
      {
        id: 0xe8,
        name: '868/915/923 MHz (with SX1262 chip)',
        firmware_filename: 'rnode_firmware_tbeam_sx1262.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_tbeam_sx1262.boot_app0',
            '0x1000': 'rnode_firmware_tbeam_sx1262.bootloader',
            '0x10000': 'rnode_firmware_tbeam_sx1262.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_tbeam_sx1262.partitions',
          },
        },
      },
    ],
  },
  {
    name: 'LilyGO T-Beam Supreme',
    catalogKey: 'lilygo-t-beam-supreme',
    id: 0xea,
    platform: 0x80,
    models: [
      {
        id: 0xdb,
        name: '433 MHz (with SX1268 chip)',
      },
      {
        id: 0xdc,
        name: '868/915/923 MHz (with SX1262 chip)',
      },
    ],
    firmware_filename: 'rnode_firmware_tbeam_supreme.zip',
    flash_config: {
      flash_size: '4MB',
      flash_files: {
        '0xe000': 'rnode_firmware_tbeam_supreme.boot_app0',
        '0x0': 'rnode_firmware_tbeam_supreme.bootloader',
        '0x10000': 'rnode_firmware_tbeam_supreme.bin',
        '0x210000': 'console_image.bin',
        '0x8000': 'rnode_firmware_tbeam_supreme.partitions',
      },
    },
  },
  {
    name: 'LilyGO T-Deck',
    catalogKey: 'lilygo-t-deck',
    id: 0xd0,
    platform: 0x80,
    models: [
      {
        id: 0xd4,
        name: '433 MHz (with SX1268 chip)',
      },
      {
        id: 0xd9,
        name: '868/915/923 MHz (with SX1262 chip)',
      },
    ],
    firmware_filename: 'rnode_firmware_tdeck.zip',
    flash_config: {
      flash_size: '4MB',
      flash_files: {
        '0xe000': 'rnode_firmware_tdeck.boot_app0',
        '0x0': 'rnode_firmware_tdeck.bootloader',
        '0x10000': 'rnode_firmware_tdeck.bin',
        '0x210000': 'console_image.bin',
        '0x8000': 'rnode_firmware_tdeck.partitions',
      },
    },
  },
  {
    name: 'LilyGO T-Echo',
    catalogKey: 'lilygo-t-echo',
    id: 0x15,
    platform: 0x70,
    models: [
      {
        id: 0x16,
        name: '433 MHz',
      },
      {
        id: 0x17,
        name: '868 MHz / 915 MHz / 923 MHz',
      },
    ],
    firmware_filename: 'rnode_firmware_techo.zip',
  },
  {
    name: 'RAK4631',
    catalogKey: 'rak4631',
    id: 0x10,
    platform: 0x70,
    models: [
      {
        id: 0x11,
        name: '433 MHz',
      },
      {
        id: 0x12,
        name: '868 MHz / 915 MHz / 923 MHz',
      },
    ],
    firmware_filename: 'rnode_firmware_rak4631.zip',
  },
  {
    name: 'RNode',
    catalogKey: 'rnode',
    id: 0x03,
    platform: 0x80,
    models: [
      {
        id: 0xa2,
        name: 'Handheld v2.1 RNode, 410 - 525 MHz',
        firmware_filename: 'rnode_firmware_ng21.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_ng21.boot_app0',
            '0x1000': 'rnode_firmware_ng21.bootloader',
            '0x10000': 'rnode_firmware_ng21.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_ng21.partitions',
          },
        },
      },
      {
        id: 0xa7,
        name: 'Handheld v2.1 RNode, 820 - 1020 MHz',
        firmware_filename: 'rnode_firmware_ng21.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_ng21.boot_app0',
            '0x1000': 'rnode_firmware_ng21.bootloader',
            '0x10000': 'rnode_firmware_ng21.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_ng21.partitions',
          },
        },
      },
      {
        id: 0xa1,
        name: 'Prototype v2.2 RNode, 410 - 525 MHz',
        firmware_filename: 'rnode_firmware_t3s3.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_t3s3.boot_app0',
            '0x0': 'rnode_firmware_t3s3.bootloader',
            '0x10000': 'rnode_firmware_t3s3.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_t3s3.partitions',
          },
        },
      },
      {
        id: 0xa6,
        name: 'Prototype v2.2 RNode, 820 - 1020 MHz',
        firmware_filename: 'rnode_firmware_t3s3.zip',
        flash_config: {
          flash_size: '4MB',
          flash_files: {
            '0xe000': 'rnode_firmware_t3s3.boot_app0',
            '0x0': 'rnode_firmware_t3s3.bootloader',
            '0x10000': 'rnode_firmware_t3s3.bin',
            '0x210000': 'console_image.bin',
            '0x8000': 'rnode_firmware_t3s3.partitions',
          },
        },
      },
    ],
  },
];
