import ReactXnft, { Button, Text, View } from "react-xnft"
import React from "react"
import Minter from "./components/Minter/Minter"

//
// On connection to the host environment, warm the cache.
//
ReactXnft.events.on("connect", () => {
  // no-op
})

export function App() {
  return (
    <View
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: "32px",
        maxWidth: "780px",
        margin: "0 auto",
      }}
    >
      <Minter />
    </View>
  )
}
