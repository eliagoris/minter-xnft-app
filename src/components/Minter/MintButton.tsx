import { CandyMachineAccount } from "../../lib/candy-machine"
import { GatewayStatus, useGateway } from "@civic/solana-gateway-react"
import { useEffect, useState, useRef } from "react"
import {
  findGatewayToken,
  getGatewayTokenAddressForOwnerAndGatekeeperNetwork,
  onGatewayTokenChange,
  removeAccountChangeListener,
} from "@identity.com/solana-gateway-ts"
import { CIVIC_GATEKEEPER_NETWORK } from "../../lib/candy-machine/utils"
import { Button, Loading, usePublicKey } from "react-xnft"
import React from "react"

const styles = {
  width: "100%",
  height: "60px",
  marginTop: "10px",
  marginBottom: "5px",
  background: "linear-gradient(180deg, #604ae5 0%, #813eee 100%)",
  color: "white",
  fontSize: "16px",
  fontWeight: "bold",
}

export const MintButton = ({
  onMint,
  candyMachine,
  isMinting,
  setIsMinting,
  isActive,
}: {
  onMint: () => Promise<void>
  candyMachine?: CandyMachineAccount
  isMinting: boolean
  setIsMinting: (val: boolean) => void
  isActive: boolean
}) => {
  const publicKey = usePublicKey()
  // @ts-ignore
  const connection = window.xnft.solana.connection
  const [verified, setVerified] = useState(false)
  const { requestGatewayToken, gatewayStatus } = useGateway()
  const [webSocketSubscriptionId, setWebSocketSubscriptionId] = useState(-1)
  const [clicked, setClicked] = useState(false)
  const [waitForActiveToken, setWaitForActiveToken] = useState(false)

  const getMintButtonContent = () => {
    if (candyMachine?.state.isSoldOut) {
      return "SOLD OUT"
    } else if (isMinting) {
      return <Loading />
    } else if (
      candyMachine?.state.isPresale ||
      candyMachine?.state.isWhitelistOnly
    ) {
      return "WHITELIST MINT"
    }

    return "MINT"
  }

  useEffect(() => {
    const mint = async () => {
      await removeAccountChangeListener(
        connection.connection,
        webSocketSubscriptionId
      )
      await onMint()

      setClicked(false)
      setVerified(false)
    }
    if (verified && clicked) {
      mint()
    }
  }, [verified, clicked, connection, onMint, webSocketSubscriptionId])

  const previousGatewayStatus = usePrevious(gatewayStatus)
  useEffect(() => {
    const fromStates = [
      GatewayStatus.NOT_REQUESTED,
      GatewayStatus.REFRESH_TOKEN_REQUIRED,
    ]
    const invalidToStates = [...fromStates, GatewayStatus.UNKNOWN]
    if (
      fromStates.find((state) => previousGatewayStatus === state) &&
      !invalidToStates.find((state) => gatewayStatus === state)
    ) {
      setIsMinting(true)
    }
    console.log("change: ", GatewayStatus[gatewayStatus])
  }, [waitForActiveToken, previousGatewayStatus, gatewayStatus])

  useEffect(() => {
    if (waitForActiveToken && gatewayStatus === GatewayStatus.ACTIVE) {
      console.log("Minting after token active")
      setWaitForActiveToken(false)
      onMint()
    }
  }, [waitForActiveToken, gatewayStatus, onMint])

  return (
    <Button
      style={styles}
      disabled={isMinting || !isActive}
      onClick={async () => {
        if (candyMachine?.state.isActive && candyMachine?.state.gatekeeper) {
          const network =
            candyMachine.state.gatekeeper.gatekeeperNetwork.toBase58()
          if (network === CIVIC_GATEKEEPER_NETWORK) {
            if (gatewayStatus === GatewayStatus.ACTIVE) {
              await onMint()
            } else {
              // setIsMinting(true);
              setWaitForActiveToken(true)
              await requestGatewayToken()
              console.log("after: ", gatewayStatus)
            }
          } else if (
            network === "ttib7tuX8PTWPqFsmUFQTj78MbRhUmqxidJRDv4hRRE" ||
            network === "tibePmPaoTgrs929rWpu755EXaxC7M3SthVCf6GzjZt"
          ) {
            setClicked(true)
            const gatewayToken = await findGatewayToken(
              connection.connection,
              publicKey!,
              candyMachine.state.gatekeeper.gatekeeperNetwork
            )

            if (gatewayToken?.isValid()) {
              await onMint()
            } else {
              window.open(
                `https://verify.encore.fans/?gkNetwork=${network}`,
                "_blank"
              )

              const gatewayTokenAddress =
                await getGatewayTokenAddressForOwnerAndGatekeeperNetwork(
                  publicKey!,
                  candyMachine.state.gatekeeper.gatekeeperNetwork
                )

              setWebSocketSubscriptionId(
                onGatewayTokenChange(
                  connection.connection,
                  gatewayTokenAddress,
                  () => setVerified(true),
                  "confirmed"
                )
              )
            }
          } else {
            setClicked(false)
            throw new Error(`Unknown Gatekeeper Network: ${network}`)
          }
        } else {
          await onMint()
          setClicked(false)
        }
      }}
      variant="contained"
    >
      {getMintButtonContent()}
    </Button>
  )
}

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>()
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref.current
}
