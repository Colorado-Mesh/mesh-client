# Glossary

Terms you will see in Mesh-Client and in these docs. Protocol names in parentheses mean the term only applies to that protocol.

## Radios and networks

**Mesh**
: A network where radios relay each other's messages, so two people can talk without a direct link or the internet.

**LoRa**
: Long Range radio modulation used by Meshtastic, MeshCore, and RNode hardware. Low bandwidth, very long reach.

**Meshtastic**
: An open-source LoRa mesh firmware and protocol. Mesh-Client's **MT** tab (green).

**MeshCore**
: A LoRa mesh firmware focused on companion radios, repeaters, and room servers. Mesh-Client's **MC** tab (cyan).

**Reticulum (RNS)**
: A cryptographic networking stack that can run over LoRa, TCP, I2P, and other links. Mesh-Client's **RN** tab (yellow). See [Reticulum](reticulum.md).

**Node**
: Any radio or device on the mesh. In Mesh-Client the **Nodes** tab lists every node you have heard.

**Companion radio**
: A radio that pairs with a phone or computer app (like Mesh-Client) over Bluetooth, USB, or Wi-Fi.

**Repeater** (MeshCore)
: A fixed node that relays traffic for others. You can manage it remotely from the **Repeaters** tab.

**Room server** (MeshCore)
: A node that hosts a bulletin-board style chat room. You log in with a password and read or post messages.

**RNode** (Reticulum)
: LoRa hardware running RNode firmware so Reticulum can use it as a radio interface.

**Sidecar** (Reticulum)
: The bundled `mesh-client-reticulum` helper program that runs the Reticulum stack alongside the app. Starting the stack starts the sidecar.

## Connections

**BLE**
: Bluetooth Low Energy, the usual way to pair a handheld radio.

**Serial (USB)**
: A wired connection to a radio plugged into your computer.

**TCP / HTTP**
: A network connection to a radio over Wi-Fi or Ethernet.

**MQTT**
: An internet message broker. Meshtastic and MeshCore can bridge mesh traffic through MQTT so you can see messages from beyond radio range.

**Interface** (Reticulum)
: One way the Reticulum stack reaches other nodes, such as a TCP server, an Auto (local network) interface, I2P, or an RNode.

## Messaging

**Channel**
: A shared group conversation. Everyone with the same channel name and key can read it.

**PSK**
: Pre-shared key. The secret that encrypts a channel.

**DM**
: Direct message to one person.

**LXMF** (Reticulum)
: The Reticulum messaging format used for direct messages.

**Propagation node** (Reticulum)
: A node that stores LXMF messages for people who are offline and delivers them when they come back.

**RRC** (Reticulum)
: Reticulum Relay Chat, hub-based group chat on the **RRC** tab.

**Nomad Network** (Reticulum)
: Pages and files hosted on Reticulum nodes, browsable from the **Nomad** tab.

**ACK**
: Acknowledgement that a message reached its destination.

## Routing and diagnostics

**Hop**
: One relay step. A message that passed through two relays traveled two hops.

**Hop limit**
: How many relays a message may pass through before it is dropped.

**Trace route**
: A test that shows which relays a message takes to reach a node.

**SNR / RSSI**
: Signal-to-noise ratio and received signal strength. Higher SNR and RSSI closer to zero mean a better link.

**Hop Goblin** (Meshtastic)
: A diagnostics finding for a relay that adds hops without adding useful range. See [Diagnostics](diagnostics.md).

**Hidden terminal**
: Two nodes that can both reach a third node but cannot hear each other, so their transmissions collide.

**Channel utilization**
: How busy the radio channel is. High utilization means more collisions and lost messages.

## Emergency communications

**EMCOMM**
: Emergency communications. See the [EMCOMM guide](emcomm.md).

**MECP**
: Mesh Emergency Communication Protocol, a compact format for emergency reports with a severity level. See [EMCOMM](emcomm.md#mecp-reports).

**Incident Command**
: The **Incident** tab, which tracks emergency reports through acknowledge, confirm, and resolve.

**TAK / CoT**
: Team Awareness Kit and its Cursor on Target message format. Mesh-Client can exchange positions and markers with TAK clients.
