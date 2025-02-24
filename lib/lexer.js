/*
	Copyright (c) 2014, Kenneth Koch <kkoch986@gmail.com>

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in
	all copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
	THE SOFTWARE.
*/
var events = require('events');

var LexerPrototype = Object.create(events.EventEmitter.prototype);
LexerPrototype.append = function(string) { for(var i in string){ lexer_append_char.call(this, string[i]); } };
LexerPrototype.end = lexer_end;

/**
 * Lexer Factory.
 **/
function Create(symbols) {
	var lexer = Object.create(LexerPrototype);
	lexer.string = "";
	lexer.token_stack = [];
	lexer.rules = [];

	// Process the rules from the input.
	// Rules must take the following form:
	// - testFull: 		A function which returns true if the given string can be entirely consumed by this token.
	// - testPrefix: 	A function which returns true if some portion of the given string, anchored at the begining, can be consumed by this token.
	// - getValue: 		A function which returns the value of the given token based on the given string, anchored at the begining.
	//						Returns false if no such value exists.
	// - removeValue: 	A function which returns the value of the given string after the prefix that can be consumed by this token is removed.
	// - symbol: 		The string value for this symbol.
	// - includeInStream: A function which returns true if the token should be pushed on to the token stack or not.
	for(var s in symbols) {
		var symbol = symbols[s];

		if(symbol.terminal === false) {
			continue ;
		}

		var valid = false;
		// Currently, only support regex string match rules.
		if(typeof symbol.match === "string") {
			lexer.rules.push({
				"symbol":s,
				"fullMatch":new RegExp("^" + symbol.match + "$", symbol.matchCaseInsensitive ? "i" : ""),
				"prefixMatch":new RegExp("^" + symbol.match, symbol.matchCaseInsensitive ? "i" : ""),
				"prefixMatchWithLookahead":new RegExp("^" + symbol.match + (symbol.lookAhead ? symbol.lookAhead : ""), symbol.matchCaseInsensitive ? "i" : ""),
				"testFull":function(string) { return this.fullMatch.test(string); },
				"testPrefix":function(string) { return this.prefixMatch.test(string); },
				"testPrefixWithLookAhead":function(string) { return this.prefixMatchWithLookahead.test(string); },
				"getValue": function(matchOnly) {
					return function(string) {
						if(!this.testPrefix(string)) {
							return false;
						}

						if(typeof matchOnly === "undefined") {
							matchOnly = 0;
						}

						return this.prefixMatch.exec(string)[matchOnly];
					}
				}(symbol.matchOnly),
				"getPriority":function(priority){
					if(typeof priority === "undefined") {
						priority = 0;
					}
					return function() {
						return priority;
					}
				}(symbol.priority),
				"removeValue":function(string) {
					return string.replace(this.prefixMatch, "");
				},
				"includeInStream": function(includeInStream) {
					return function() {
						return includeInStream !== false;
					}
				}(symbol.includeInStream)
			});
			valid = true;
		}

		if(!valid) {
			throw "Symbol `" + s + "` does not contain valid `match` rule.";
		}
	}

	return lexer;
}

/**
 * Append a token to the lexer stream.
 * NOTE: this function must be called one character at a time.
 *
 * The lexer will perform various tasks at this point.
 *   1. Loop over each rule and test the rule against the current stream.
 *	 	If there is a full match, don't do anything.
 *		If there are prefix matches and no full matches
 *			Remove the matching portion from the longest prefix match from
 * 			the begining of the string and push that value on to the token stack.
 * 		If there are still full matches, keep going.
 **/
function lexer_append_char(char) {
	if(char) {
		this.string += char;
	}
	var consumed = true;

	while(consumed === true) {
		consumed = false;
		var prefixMatches = [];
		var fullMatches = [];
		for(var r in this.rules) {
			var rule = this.rules[r];
			if(rule.testPrefixWithLookAhead(this.string)) {
				if(rule.testFull(this.string)) {
					fullMatches.push(rule);
				} else {
					prefixMatches.push(rule);
				}
			}
		}

		// If we found prefix matches and no full matches,
		// pick the longest prefix match.
		if(prefixMatches.length > 0 && fullMatches.length === 0) {
			var longest = 0;
			var longestRule = null;
			var longestPriority = -1;
			var tie = false;

			for(var r in prefixMatches) {
				var rule = prefixMatches[r];
				var length = rule.getValue(this.string).length;
				if(length > longest) {
					longest = length;
					longestRule = rule;
					longestPriority = rule.getPriority();
					tie = false;
				} else if(length == longest) {
					// see if the tie is broken by priority
					if(longestPriority === rule.getPriority()) {
						tie = true;
					} else if(rule.getPriority() > longestPriority) {
						longest = length;
						longestRule = rule;
						longestPriority = rule.getPriority();
						tie = false;
					}
				}
			}

			if(longestRule !== null && tie !== false) {
				
				if(longestRule.includeInStream()) {
					this.token_stack.push(tok);
					var value = rule.getValue(this.string);
					var tok = {"type":longestRule.symbol, "value":value};
					this.emit("token", tok);
				}
				this.string = longestRule.removeValue(this.string);
				consumed = true;
			}
		}
	}

}

/**
 * Produces an "end" event.
 * This will loop over the string until no more tokens can be extracted.
 * Full matches will be executed immediately, prefix matches will be executed 
 * in order of match length
 **/
function lexer_end() {

	// Apply the rules one more time looking for a full match
	var consumed = true;
	while(consumed === true) {
		consumed = false;
		var prefixMatches = [];

		for(var r in this.rules) {
			var rule = this.rules[r];
			if(rule.testPrefixWithLookAhead(this.string) || rule.testFull(this.string)) {
				if(rule.testFull(this.string)) {
					if(rule.includeInStream()) {
						var value = rule.getValue(this.string);
						var tok = {"type":rule.symbol, "value":value};
						this.token_stack.push(tok);
						this.emit("token", tok);
					}
					this.string = rule.removeValue(this.string);
					consumed = true;
					break ;
				} else {
					prefixMatches.push(rule);
				}
			}
		}


		// If we found prefix matches and no full matches,
		// pick the longest prefix match.
		if(prefixMatches.length > 0 && consumed === false) {
			var longest = 0;
			var longestRule = null;
			var longestPriority = -1;
			var tie = false;

			for(var r in prefixMatches) {
				var rule = prefixMatches[r];
				var length = rule.getValue(this.string).length;
				if(length > longest) {
					longest = length;
					longestRule = rule;
					longestPriority = rule.getPriority();
					tie = false;
				} else if(length == longest) {
					// see if the tie is broken by priority
					if(longestPriority === rule.getPriority()) {
						tie = true;
					} else if(rule.getPriority() > longestPriority) {
						longest = length;
						longestRule = rule;
						longestPriority = rule.getPriority();
						tie = false;
					}
				}
			}

			if(longestRule !== null) {
				if(longestRule.includeInStream()) {
					var value = rule.getValue(this.string);
					var tok = {"type":longestRule.symbol, "value":value};
					this.token_stack.push(tok);
					this.emit("token", tok);
				}
				this.string = longestRule.removeValue(this.string);
				consumed = true;
			}
		}
	}

	if(this.string.length !== 0) {
		throw "Unrecognized characters at end of stream: '" + this.string + "'";
	}

	this.emit("end");
}

module.exports.Create = Create;
