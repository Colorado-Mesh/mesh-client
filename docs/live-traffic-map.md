# Live traffic map

Use **Map → Live traffic** to watch packet observations on your mesh. The map works worldwide with Meshtastic and MeshCore. Reticulum uses its existing map and does not have this live traffic view.

## Choose a traffic source

| Protocol   | Available sources                                | What you need                                                                                                                |
| ---------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Meshtastic | Packets observed by your client                  | A connected Meshtastic radio, or incoming MQTT observations                                                                  |
| MeshCore   | Local radio, Regional Beacon, Regional CoreScope | A connected MeshCore radio for local traffic; an internet connection and a compatible public map server for regional traffic |

Local traffic is limited to what your client observes. It is not a complete view of every packet on a regional network. Nodes need known positions before their locations or links can be drawn; a packet can still appear in the packet feed without a known location.

### Local radio

1. Select **Meshtastic** or **MeshCore** in the protocol switcher and connect your radio normally.
2. Open **Map**, then select **Live traffic**.
3. On MeshCore, select **Local radio** in **Traffic source**. Meshtastic uses local observations automatically, so it has no regional feed configuration.
4. Leave **Map area** on **All traffic**, or choose **Current map area** to filter observations to the part of the world you are viewing.

The initial view fits your known node positions, including your configured location when available. A few nodes far from all the others, such as one reporting a placeholder position on another continent, are left out of that first view so the map frames your mesh; zoom out to see them. Without valid positions, it opens a world view. There is no Colorado-only region list or geographic restriction. Pan and zoom to any location; use **Fit traffic** to bring current packet locations into view, or known nodes if no packet has a location.

### Regional Beacon or CoreScope

These sources carry **MeshCore** observations. You can use them without a connected local radio.

1. Select **MeshCore → Map → Live traffic**.
2. In **Traffic source**, select **Regional Beacon** or **Regional CoreScope**. The connection settings open.
3. Choose a preset for your community, or choose **Custom URL** and enter your community's map URL. Select the provider that matches the server: Beacon and CoreScope have different APIs.
4. Click **Connect**. Selecting a preset alone does not connect.
5. Use the **Configure** button to reopen the source settings. If the server offers regions, select one from its **Feed region** list and click **Connect** again to apply it. **All regions** listens across that server's available coverage.
6. Use **Disconnect** in the source settings when you want to end the session.

Presets are shortcuts, not a list of supported countries. Any compatible public Beacon or CoreScope deployment can be entered as a custom URL. Ask your regional map operator for the correct URL and provider if you are unsure. The region list comes from that server; changing it does not configure your radio's region, frequency, or MeshCore flood scope.

The supported public feeds do **not** require an API key. This connection form does not support administrator keys or private authenticated feeds. It only reads the selected server; it does not upload your local radio packets, messages, node directory, or location.

## Filter and navigate

- **All traffic** includes observations from the selected source regardless of location. A selected server region still limits a regional feed.
- **Current map area** includes observations with a known location inside the visible map. Pan or zoom to change that area. Packets with no known location cannot match this geographic filter.
- **Filters** opens packet-type and playback controls. Local MeshCore also offers a **Transport code** filter; it filters observed packet metadata and does not change radio settings.
- **+ / −** zoom in half-level steps. **Fit traffic** frames current packet locations, falling back to known nodes.
- **Pause** freezes the displayed observations and animation for inspection. Use **Resume** to return to live traffic. Pause does not disconnect a regional feed.

## Use the packet feed

Click **Packet feed** to expand or collapse the floating window. Drag its handle to move it around the map. You can also focus the move handle and use the arrow keys; hold Shift for larger moves. Expand the window when you need more room.

Repeated observations of the same packet share one row. The reports count shows how many observations were grouped. Select a row to inspect its known locations, links, signal details, and message content when available. New reports can add branches to that packet's map path.

Message text appears only when the client or regional feed provides decoded content. Encrypted or unavailable content stays labeled as such. Regional observations do not become messages in your normal chat history.

Animation shows observation order, not radio propagation speed. Missing positions and unknown hops leave gaps. Meshtastic draws a direct source-to-client link only for a known direct radio reception; multihop and MQTT packets do not invent intermediate hops. CoreScope links based on server identity estimates are marked as estimated.

## Open the map in its own window

Click **Open in new window**, the button after **Pause**, to move the live map into a separate window. Put it on a second monitor or in a corner of the screen while you use the rest of the app. The Map panel shows a notice in its place: **Show window** brings the window forward and **Move back here** closes it.

- The window opens on the same protocol, map position, map style and traffic source. A regional feed you connected reconnects there, and the main window's connection ends, so only one window holds the session.
- Packets your radio receives keep arriving while the main window shows another panel or protocol, or sits behind other windows.
- Click a node on the map to open its details in the main window.
- **Keep on top** keeps the window above other windows. **Return to main window** closes it and puts the map back in the Map panel where you left it.
- MeshCore and Meshtastic can each have a window open at the same time. Each remembers its size, position and **Keep on top** setting.
- Closing or reloading the main window closes these windows.

## Navigation and saved settings

During the same app session, switching panels, switching protocols, or returning to **Overview** preserves each protocol's live view, filters, map position, floating feed state, and regional connection. Drawing stops while the live map is hidden.

Changing the source or explicitly disconnecting ends the regional session. Closing the app also ends it. Each provider's URL is saved, but you must click **Connect** again after restarting the app.

## If the map looks empty

- Check that the selected source is receiving packets. Local mode needs observations arriving at your client; a regional source must show a live connection.
- Switch **Map area** to **All traffic** and clear packet-type or transport-code filters. For a regional source, check its server region selection too.
- Click **Fit traffic**. Your nodes or observers may be outside the current view, and a node far from all the others is left out of the first view.
- Check **Packet feed**. Observations without known positions can appear there even when the map has no paths. Unknown locations are not guessed.
- If a custom server will not connect, verify its URL, provider, and public API availability with the operator. A partial-directory notice means the node directory reached the client's limit, so some locations may be absent.

For offline basemaps, see [Map tab without internet](troubleshooting.md#map-tab-without-internet-offline--no-wan). Regional internet feeds still need connectivity. Implementation details are in the [developer reference](development/live-packet-map.md).
