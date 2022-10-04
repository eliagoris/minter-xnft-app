import Countdown from "react-countdown"
import React from "react"
import { Text, View } from "react-xnft"

const styles = {
  root: {
    display: "flex",
    padding: 0,
    "& > *": {
      margin: "4px",
      width: "64px",
      height: "64px",
      display: "flex",
      flexDirection: "column",
      alignContent: "center",
      alignItems: "center",
      justifyContent: "center",
      background: "#384457",
      color: "white",
      borderRadius: 5,
      fontSize: 10,
    },
  },
  done: {
    display: "flex",
    margin: 0,
    marginBottom: "2px",
    height: "32px",
    padding: "8px",
    flexDirection: "column",
    alignContent: "center",
    alignItems: "center",
    justifyContent: "center",
    background: "#384457",
    color: "white",
    borderRadius: 5,
    fontWeight: "bold",
    fontSize: 18,
  },
  item: {
    fontWeight: "bold",
    fontSize: 18,
  },
}

interface MintCountdownProps {
  date: Date | undefined
  style?: React.CSSProperties
  status?: string
  onComplete?: () => void
}

interface MintCountdownRender {
  days: number
  hours: number
  minutes: number
  seconds: number
  completed: boolean
}

export const MintCountdown: React.FC<MintCountdownProps> = ({
  date,
  status,
  style,
  onComplete,
}) => {
  const renderCountdown = ({
    days,
    hours,
    minutes,
    seconds,
    completed,
  }: MintCountdownRender) => {
    hours += days * 24
    if (completed) {
      return status ? <Text style={styles.done}>{status}</Text> : null
    } else {
      return (
        <div style={styles.root}>
          <View elevation={0}>
            <Text style={styles.item}>{hours < 10 ? `0${hours}` : hours}</Text>
            <Text>hrs</Text>
          </View>
          <View elevation={0}>
            <Text style={styles.item}>
              {minutes < 10 ? `0${minutes}` : minutes}
            </Text>
            <Text>mins</Text>
          </View>
          <View elevation={0}>
            <Text style={styles.item}>
              {seconds < 10 ? `0${seconds}` : seconds}
            </Text>
            <Text>secs</Text>
          </View>
        </div>
      )
    }
  }

  if (date) {
    return (
      <Countdown
        date={date}
        onComplete={onComplete}
        renderer={renderCountdown}
      />
    )
  } else {
    return null
  }
}
